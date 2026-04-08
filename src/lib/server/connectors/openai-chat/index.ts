import { env } from '$env/dynamic/private';
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption
} from 'openai/resources/chat/completions';
import { deriveVehicleInspectionCapabilities } from '$lib/server/connectors/gltf-preprocess';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import {
  annotateVehicleSemanticGroup,
  generateVehicleSemanticOverlay,
  getVehicleSemanticOverlayStatus,
  readVehicleSemanticOverlay
} from '$lib/server/connectors/vehicle-semantic-overlay';
import {
  isVehicleEditRequest,
  planNormalizedVehiclePaintIntent,
  resolveVehicleIntent,
  type NormalizedVehiclePaintIntent
} from '$lib/server/connectors/vehicle-intents';
import { isVehicleAssetId, type VehicleAssetId } from '$lib/vehicles/catalog';
import type {
  FooterChatRequest,
  FooterChatPresentationContext,
  FooterChatPresentationRestore,
  FooterChatPresentationTarget,
  FooterChatResponse,
  FooterChatVehiclePatchOperation
} from './types';
import type { VehicleSemanticGroupAnnotation } from '$lib/server/connectors/vehicle-semantic-overlay/types';
import type { VehicleNodeSelection } from '$lib/stores/vehicle-node-selection';

const DEFAULT_MODEL = 'gpt-5.2';
const MAX_TOOL_ROUNDS = 2;
const APPLY_VEHICLE_APPEARANCE_INTENT_TOOL_NAME = 'apply_vehicle_appearance_intent';
const APPLY_VEHICLE_FOCUS_INTENT_TOOL_NAME = 'apply_vehicle_focus_intent';
const SET_VEHICLE_VIEW_MODE_TOOL_NAME = 'set_vehicle_view_mode';
const EXPAND_VEHICLE_SELECTION_TOOL_NAME = 'expand_vehicle_selection';
const ANNOTATE_VEHICLE_SEMANTIC_GROUP_TOOL_NAME = 'annotate_vehicle_semantic_group';
const REFRESH_VEHICLE_SEMANTICS_TOOL_NAME = 'refresh_vehicle_semantics';
const LEGACY_APPLY_VEHICLE_INTENT_TOOL_NAME = 'apply_vehicle_intent';
const LEGACY_APPLY_VEHICLE_PAINT_INTENT_TOOL_NAME = 'apply_vehicle_paint_intent';

let client: OpenAI | null = null;

export class OpenAIChatConfigError extends Error { }
export class OpenAIChatInputError extends Error { }
export class OpenAIChatUpstreamError extends Error { }

function getClient(): OpenAI {
  if (!env.OPENAI_API_KEY) {
    throw new OpenAIChatConfigError('OPENAI_API_KEY is not configured.');
  }

  client ??= new OpenAI({
    apiKey: env.OPENAI_API_KEY
  });

  return client;
}

type NormalizedFooterChatRequest = {
  message: string;
  assetId?: VehicleAssetId;
  selectedNodeId?: string;
  selectedNodeName?: string;
  selectedNodePath?: string;
  selectedNodes: VehicleNodeSelection[];
  presentation?: FooterChatPresentationContext;
};

type SemanticOverlayState = 'missing' | 'stale' | 'fresh' | 'unknown';

function normalizeRequest(input: FooterChatRequest): NormalizedFooterChatRequest {
  const message = input.message.trim();

  if (!message) {
    throw new OpenAIChatInputError('Message is required.');
  }

  return {
    message,
    assetId: input.assetId && isVehicleAssetId(input.assetId) ? input.assetId : undefined,
    selectedNodeId:
      typeof input.selectedNodeId === 'string'
        ? input.selectedNodeId.trim() || undefined
        : undefined,
    selectedNodeName:
      typeof input.selectedNodeName === 'string'
        ? input.selectedNodeName.trim() || undefined
        : undefined,
    selectedNodePath:
      typeof input.selectedNodePath === 'string'
        ? input.selectedNodePath.trim() || undefined
        : undefined,
    selectedNodes: Array.isArray(input.selectedNodes)
      ? input.selectedNodes.filter(
        (entry): entry is VehicleNodeSelection =>
          !!entry &&
          typeof entry.assetId === 'string' &&
          typeof entry.nodeId === 'string' &&
          typeof entry.nodeName === 'string' &&
          typeof entry.nodePath === 'string'
      )
      : [],
    presentation: normalizePresentationContext(input.presentation)
  };
}

function normalizePresentationTarget(
  input: FooterChatPresentationTarget | null | undefined
): FooterChatPresentationTarget | null {
  if (!input || typeof input.targetId !== 'string') {
    return null;
  }

  const targetId = input.targetId.trim();
  if (!targetId) {
    return null;
  }

  return {
    targetId,
    targetName:
      typeof input.targetName === 'string' ? input.targetName.trim() || undefined : undefined,
    operation:
      typeof input.operation === 'string' && input.operation.trim().length > 0
        ? input.operation
        : undefined
  };
}

function normalizePresentationContext(
  input: FooterChatPresentationContext | null | undefined
): FooterChatPresentationContext | undefined {
  if (!input) {
    return undefined;
  }

  const normalizeTargets = (
    targets: FooterChatPresentationContext['highlightedTargets']
  ): FooterChatPresentationTarget[] | undefined => {
    const normalized = Array.isArray(targets)
      ? targets
          .map((target) => normalizePresentationTarget(target))
          .filter((target): target is FooterChatPresentationTarget => target !== null)
      : [];

    return normalized.length > 0 ? normalized : undefined;
  };

  const viewerModes = Array.isArray(input.viewerModes)
    ? input.viewerModes.filter(
        (mode): mode is NonNullable<FooterChatPresentationContext['viewerModes']>[number] =>
          mode === 'wireframe' || mode === 'xray' || mode === 'uv_debug' || mode === 'postprocess'
      )
    : [];

  const normalized: FooterChatPresentationContext = {
    activeIntentLabel:
      typeof input.activeIntentLabel === 'string'
        ? input.activeIntentLabel.trim() || undefined
        : undefined,
    highlightedTargets: normalizeTargets(input.highlightedTargets),
    materialTargets: normalizeTargets(input.materialTargets),
    hiddenTargets: normalizeTargets(input.hiddenTargets),
    viewerModes: viewerModes.length > 0 ? viewerModes : undefined
  };

  if (
    !normalized.activeIntentLabel &&
    !normalized.highlightedTargets &&
    !normalized.materialTargets &&
    !normalized.hiddenTargets &&
    !normalized.viewerModes
  ) {
    return undefined;
  }

  return normalized;
}

function describePresentationTargets(
  label: string,
  targets: FooterChatPresentationTarget[] | undefined
): string | null {
  if (!targets || targets.length === 0) {
    return null;
  }

  return `${label}: ${targets
    .map((target) =>
      `${target.targetId}${target.targetName ? ` (${target.targetName})` : ''}${target.operation ? ` via ${target.operation}` : ''}`
    )
    .join('; ')}.`;
}

function toOpenAIMessages(
  input: NormalizedFooterChatRequest,
  semanticOverlayState: SemanticOverlayState
): ChatCompletionMessageParam[] {
  const activeAssetLine = input.assetId
    ? `Active asset ID: ${input.assetId}.`
    : 'No active asset ID was provided.';
  const semanticOverlayLine = input.assetId
    ? `Semantic overlay status for the active asset: ${semanticOverlayState}.`
    : 'Semantic overlay status is unavailable because no active asset was provided.';
  const scopedSelectedNodes = input.selectedNodes.filter(
    (entry) => entry.assetId === input.assetId
  );
  const selectedNodeLine =
    input.assetId && scopedSelectedNodes.length > 0
      ? `Selected runtime nodes: ${scopedSelectedNodes
        .map(
          (entry) =>
            `${entry.nodeId} (${entry.nodeName}) at path ${entry.nodePath}${entry.materialName ? ` using material ${entry.materialName}` : ''}${typeof entry.materialIndex === 'number' ? ` at material slot ${entry.materialIndex}` : ''}`
        )
        .join('; ')}.`
      : input.assetId && input.selectedNodeId
        ? `Selected runtime node context: ${input.selectedNodeId}${input.selectedNodeName ? ` (${input.selectedNodeName})` : ''}${input.selectedNodePath ? ` at path ${input.selectedNodePath}` : ''}.`
        : 'No runtime node is currently selected.';
  const presentationLines = [
    input.presentation?.activeIntentLabel
      ? `Active presentation intent: ${input.presentation.activeIntentLabel}.`
      : null,
    describePresentationTargets(
      'Active highlighted material regions',
      input.presentation?.highlightedTargets
    ),
    describePresentationTargets(
      'Active material edits',
      input.presentation?.materialTargets
    ),
    describePresentationTargets(
      'Active hidden runtime nodes',
      input.presentation?.hiddenTargets
    ),
    input.presentation?.viewerModes && input.presentation.viewerModes.length > 0
      ? `Active viewer modes: ${input.presentation.viewerModes.join(', ')}.`
      : null
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
  const presentationContextLine =
    presentationLines.length > 0
      ? presentationLines
      : 'No active highlight, material, visibility, or viewer mode context is currently applied.';

  return [
    {
      role: 'developer',
      content: `You are JARVIS working on GLB/GLTF automobiles, helping interpret a vehicle for understanding and future physical AI work. Be concise, practical, and technical. Keep responses short by default.
Use the tool catalog deliberately:
- appearance tool: paint, recolor, tint, chrome, matte, gloss, material appearance, nuanced freeform colors
- focus tool: highlight, focus, isolate, remove, bring out
- view mode tool: wireframe, xray, uv debug, postprocess
- semantic annotation tool: assign selected nodes/material regions into semantic groups
- expand selection tool: lift the current selection to node, part, or semantic group
- semantic refresh tool: explicitly rebuild or refresh semantics
For simple core paint colors, normalized paint fields are helpful. For nuanced or uncommon color language like off white, ivory, cream, eggshell, champagne, aubergine, bone, or sand, prefer the freeform appearance request instead of forcing the color into the normalized palette.
When selected runtime nodes exist and the user clearly refers to this, these, selected, or the current selection, use selection scope so the resulting operations apply only to the selected nodes or selected material regions.
When the user refers to highlighted, glowing, hidden, visible, xray, wireframe, uv debug, postprocess, the current view, or what is currently being shown, use the active presentation context below as grounding even if the region is not explicitly selected.
Use the semantic refresh tool when the user explicitly asks to enrich, refresh, rebuild, or reanalyze vehicle semantics.
Use the expand selection tool when the user explicitly asks to expand, lift, promote, or extend the current selection into a node, part, or semantic group.
Use the semantic group annotation tool when the user says the selected node or selected nodes are, belong to, or should be a semantic group like wheels, doors, glasshouse, body shell, front face, trim, interior, headlights, taillights, front lighting, rear lighting, or other. Resolve existing shared groups first and create a new shared semantic group only when no existing definition matches. Only do this when the user is explicitly assigning semantics, not when merely asking a question.
Do not regenerate semantic overlays unless the user explicitly asks to refresh, rebuild, or regenerate semantics.
Semantic overlays are shared cached artifacts across sessions. Missing or stale overlays should be reported, not rebuilt automatically.
Infer the user's intent freely from the request, but rely on the tool to resolve that request into valid deterministic operations.
Do not ask the user to rephrase into template commands when a natural-language request can be normalized into a deterministic vehicle operation.
Only say a vehicle edit was applied when the tool returned one or more accepted operations. If no operations were accepted, say that you could not apply the requested change.
The executor owns asset selection deterministically. The tool always applies to the active asset only, never to an inferred or alternate asset.
${activeAssetLine}
${semanticOverlayLine}
${selectedNodeLine}
${presentationContextLine}`
    },
    {
      role: 'user',
      content: input.message
    }
  ];
}

const CHAT_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: APPLY_VEHICLE_APPEARANCE_INTENT_TOOL_NAME,
      description:
        'Apply appearance changes to the active vehicle or current selection, including tint, paint, recolor, chrome, matte, gloss, and highlight-style material appearance changes.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          request: {
            type: 'string',
            description:
              'Optional freeform appearance request such as 5% black tint, smoked glass, dark purple chrome, or make this matte black.'
          },
          colorFamily: {
            type: 'string',
            description:
              'Optional normalized core color family such as purple, blue, red, green, black, silver, white, bronze, gold, or gray.'
          },
          shade: {
            type: 'string',
            enum: ['very_dark', 'dark', 'medium', 'light', 'very_light']
          },
          saturation: {
            type: 'string',
            enum: ['muted', 'balanced', 'vivid']
          },
          finish: {
            type: 'string',
            enum: ['solid', 'metallic', 'chrome', 'matte', 'pearl', 'gloss']
          },
          hex: {
            type: 'string',
            description: 'Optional exact color override in #RRGGBB, RRGGBB, #RGB, or RGB format.'
          },
          scope: {
            type: 'string',
            enum: ['asset', 'selection'],
            description:
              'Optional execution scope. Use selection when the user refers to the current selected runtime region.'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: APPLY_VEHICLE_FOCUS_INTENT_TOOL_NAME,
      description:
        'Apply semantic focus operations to the active vehicle or current selection, including highlight, focus, isolate, remove, and bring-out style requests.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          request: {
            type: 'string',
            description:
              'Freeform focus request such as highlight the wheels, isolate these windows, remove the front lighting, or bring out the grille.'
          },
          scope: {
            type: 'string',
            enum: ['asset', 'selection'],
            description:
              'Optional execution scope. Use selection when the user refers to the current selected runtime region.'
          }
        },
        required: ['request']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: SET_VEHICLE_VIEW_MODE_TOOL_NAME,
      description:
        'Enable or disable a viewer mode on the active asset, such as wireframe, xray, uv debug, or postprocess.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: {
            type: 'string',
            enum: ['wireframe', 'xray', 'uv_debug', 'postprocess']
          },
          enabled: {
            type: 'boolean',
            description: 'Set true to enable the mode or false to disable it.'
          }
        },
        required: ['mode', 'enabled']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: EXPAND_VEHICLE_SELECTION_TOOL_NAME,
      description:
        'Expand the current selected runtime region(s) into a larger deterministic abstraction such as the whole node, a semantic part, or a semantic group.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          target: {
            type: 'string',
            enum: ['node', 'part', 'semantic_group']
          },
          query: {
            type: 'string',
            description:
              'Optional freeform semantic target such as wheel, wheels, glasshouse, or front lighting when expanding into a part or semantic group.'
          }
        },
        required: ['target']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: ANNOTATE_VEHICLE_SEMANTIC_GROUP_TOOL_NAME,
      description:
        'Assign the currently selected runtime node to a shared semantic group for the active asset.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nodeId: {
            type: 'string',
            description:
              'A selected runtime node ID to annotate. Use this for single-node assignment.'
          },
          nodeIds: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional list of selected runtime node IDs to annotate together when the user has multiselected nodes.'
          },
          semanticGroup: {
            type: 'string',
            description:
              'Freeform semantic group name from the user such as headlights, wheels, glasshouse, number plate, or propeller. Prefer this when mirroring the user wording.'
          },
          category: {
            type: 'string',
            enum: [
              'wheels',
              'doors',
              'front_lighting',
              'rear_lighting',
              'glasshouse',
              'body_shell',
              'front_face',
              'trim',
              'interior',
              'other'
            ]
          },
          humanLabel: {
            type: 'string',
            description:
              'Optional human label, especially useful when the semantic group should be created as a new shared concept.'
          },
          aliases: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: REFRESH_VEHICLE_SEMANTICS_TOOL_NAME,
      description:
        'Generate or refresh the semantic overlay for the active vehicle asset without changing any structural manifest IDs.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          force: {
            type: 'boolean',
            description:
              'Set true only when the user explicitly asks to refresh, rebuild, or regenerate semantics even if the overlay is already fresh.'
          }
        }
      }
    }
  }
];

type ApplyVehicleAppearanceIntentToolArgs = Partial<NormalizedVehiclePaintIntent> & {
  request?: string;
  scope?: 'asset' | 'selection';
};

type ApplyVehicleFocusIntentToolArgs = {
  request: string;
  scope?: 'asset' | 'selection';
};

type SetVehicleViewModeToolArgs = {
  mode: 'wireframe' | 'xray' | 'uv_debug' | 'postprocess';
  enabled: boolean;
};
type ExpandVehicleSelectionToolArgs = {
  target: 'node' | 'part' | 'semantic_group';
  query?: string;
};
type AnnotateVehicleSemanticGroupToolArgs = VehicleSemanticGroupAnnotation;

type RefreshVehicleSemanticsToolArgs = {
  force?: boolean;
};

type ExecutedToolResult = {
  message: ChatCompletionMessageParam;
  plannedOperations?: FooterChatVehiclePatchOperation[];
  intentLabel?: string;
  selectionUpdate?: VehicleNodeSelection[];
  selectionUpdateLabel?: string;
};

function isSemanticRefreshRequest(message: string): boolean {
  return /\b(refresh|rebuild|regenerate|reanaly[sz]e|enrich)\b.*\b(semantic|semantics|overlay|manifest|labels?)\b/i.test(
    message
  );
}

function requestNeedsSemanticGrounding(message: string): boolean {
  return /\b(paint|repaint|body color|body paint|glass|window|tint|headlight|headlights|wheel|wheels|rim|rims|grille|highlight|isolate|spotlight)\b/i.test(
    message
  );
}

function isSelectionScopedLanguage(message: string): boolean {
  return /\b(this|these|selected|selection|current selection)\b/i.test(message);
}

function isSelectionScopedViewerModeRequest(message: string): boolean {
  return /\b(wireframe|xray|x-ray|uv|uv_debug|postprocess|post-processing|postprocessing)\b/i.test(
    message
  );
}

function isGlobalAssetTargetRequest(message: string): boolean {
  return /\b(body|car|vehicle|whole car|whole vehicle|entire car|entire vehicle|all\b|everything\b)\b/i.test(
    message
  );
}

function isTargetableSelectionEditRequest(message: string): boolean {
  return /\b(tint|glass|window|windshield|smoke|limo|highlight|isolate|remove|paint|repaint|recolor|color|darken|lighten|chrome|matte|metallic|pearl|gloss)\b/i.test(
    message
  );
}

function shouldAttemptDirectSelectionEdit(input: NormalizedFooterChatRequest): boolean {
  const scopedSelections = input.selectedNodes.filter((entry) => entry.assetId === input.assetId);
  if (!input.assetId || scopedSelections.length === 0) {
    return false;
  }

  if (
    !isVehicleEditRequest(input.message) ||
    isSemanticRefreshRequest(input.message) ||
    isSemanticAnnotationRequest(input.message) ||
    isSelectionScopedViewerModeRequest(input.message)
  ) {
    return false;
  }

  if (isSelectionScopedLanguage(input.message)) {
    return true;
  }

  return (
    isTargetableSelectionEditRequest(input.message) && !isGlobalAssetTargetRequest(input.message)
  );
}

function shouldAttemptDirectVehicleEdit(input: NormalizedFooterChatRequest): boolean {
  if (
    !input.assetId ||
    !isVehicleEditRequest(input.message) ||
    isSemanticRefreshRequest(input.message)
  ) {
    return false;
  }

  if (isSemanticAnnotationRequest(input.message)) {
    return false;
  }

  return true;
}

function isRestoreRequest(message: string): boolean {
  return /\b(restore|revert|reset|bring\b.*\bback|put\b.*\bback|show\b.*\bagain|make (it )?normal again|back to normal|original view|default view|turn .* back on)\b/i.test(
    message
  );
}

function isRestoreAllRequest(message: string): boolean {
  return /\b(restore everything|reset everything|reset all|revert all|make (it )?normal again|back to normal|restore the vehicle|restore the car|original view|default view)\b/i.test(
    message
  );
}

function matchesRestoreTarget(message: string, target: FooterChatPresentationTarget): boolean {
  const haystack = `${target.targetId} ${target.targetName ?? ''}`.toLowerCase();
  const baseTerms = message
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2);
  const terms = Array.from(
    new Set(
      baseTerms.flatMap((term) =>
        term.endsWith('s') && term.length > 3 ? [term, term.slice(0, -1)] : [term]
      )
    )
  );

  return terms.some((term) => haystack.includes(term));
}

function getTargetIdsForRestore(
  message: string,
  targets: FooterChatPresentationTarget[] | undefined
): string[] {
  if (!targets || targets.length === 0) {
    return [];
  }

  const matched = targets.filter((target) => matchesRestoreTarget(message, target));
  return (matched.length > 0 ? matched : targets).map((target) => target.targetId);
}

function getViewerModesForRestore(
  message: string,
  viewerModes: NonNullable<FooterChatPresentationContext['viewerModes']> | undefined
): NonNullable<FooterChatPresentationContext['viewerModes']> {
  if (!viewerModes || viewerModes.length === 0) {
    return [];
  }

  const modeMatches = viewerModes.filter((mode) => {
    if (mode === 'uv_debug') {
      return /\buv\b|\buv debug\b|\buv_debug\b/i.test(message);
    }

    if (mode === 'postprocess') {
      return /\bpostprocess\b|\bpost-processing\b|\bpostprocessing\b/i.test(message);
    }

    return new RegExp(`\\b${mode === 'xray' ? 'xray|x-ray' : mode}\\b`, 'i').test(message);
  });

  return modeMatches.length > 0 ? modeMatches : viewerModes;
}

function buildPresentationRestore(
  input: NormalizedFooterChatRequest
): FooterChatPresentationRestore | null {
  if (!input.presentation || !isRestoreRequest(input.message)) {
    return null;
  }

  if (isRestoreAllRequest(input.message)) {
    return {
      restoreAll: true,
      label: 'restore original view'
    };
  }

  const message = input.message;
  const highlightedTargetIds = /\b(highlight|highlighted|glow|glowing)\b/i.test(message)
    ? getTargetIdsForRestore(message, input.presentation.highlightedTargets)
    : [];
  const hiddenTargetIds = /\b(bring\b.*\bback|put\b.*\bback|show\b.*\bagain|restore|reveal|unhide|removed|hidden)\b/i.test(
    message
  )
    ? getTargetIdsForRestore(message, input.presentation.hiddenTargets)
    : [];
  const viewerModes = /\b(xray|x-ray|wireframe|uv|uv debug|uv_debug|postprocess|post-processing|postprocessing|layer)\b/i.test(
    message
  )
    ? getViewerModesForRestore(message, input.presentation.viewerModes)
    : [];
  const materialTargetIds = /\b(restore|normal|default|original|material|paint|tint|glass|window|body|wheel|wheels)\b/i.test(
    message
  )
    ? getTargetIdsForRestore(message, input.presentation.materialTargets)
    : [];

  if (
    highlightedTargetIds.length === 0 &&
    hiddenTargetIds.length === 0 &&
    viewerModes.length === 0 &&
    materialTargetIds.length === 0
  ) {
    return null;
  }

  return {
    highlightedTargetIds: highlightedTargetIds.length > 0 ? highlightedTargetIds : undefined,
    hiddenTargetIds: hiddenTargetIds.length > 0 ? hiddenTargetIds : undefined,
    viewerModes: viewerModes.length > 0 ? viewerModes : undefined,
    materialTargetIds: materialTargetIds.length > 0 ? materialTargetIds : undefined,
    label: 'restore original view'
  };
}

function isSemanticAnnotationRequest(message: string): boolean {
  return (
    /\b(belongs to|part of|group this as|classify this as|mark this as|assign this to)\b/i.test(
      message
    ) || /^\s*(this|these)\s+(is|are|should be)\s+/i.test(message)
  );
}

function isSelectionExpansionRequest(message: string): boolean {
  return /\b(expand|extend|promote|lift)\b.*\b(selection|selected|this|these)\b/i.test(message);
}

function getToolChoiceForRequest(
  input: NormalizedFooterChatRequest
): ChatCompletionToolChoiceOption | undefined {
  if (
    !isVehicleEditRequest(input.message) &&
    !isSemanticRefreshRequest(input.message) &&
    !(
      (input.selectedNodeId || input.selectedNodes.length > 0) &&
      isSelectionExpansionRequest(input.message)
    ) &&
    !(
      (input.selectedNodeId || input.selectedNodes.length > 0) &&
      isSemanticAnnotationRequest(input.message)
    )
  ) {
    return undefined;
  }

  return 'required';
}

function parseApplyVehicleAppearanceIntentToolArgs(
  input: string
): ApplyVehicleAppearanceIntentToolArgs {
  const parsed = JSON.parse(input) as ApplyVehicleAppearanceIntentToolArgs;
  return {
    request: typeof parsed.request === 'string' ? parsed.request.trim() || undefined : undefined,
    colorFamily:
      typeof parsed.colorFamily === 'string' ? parsed.colorFamily.trim() || undefined : undefined,
    shade: parsed.shade,
    saturation: parsed.saturation,
    finish: parsed.finish,
    hex: parsed.hex,
    scope: parsed.scope === 'selection' ? 'selection' : 'asset'
  };
}

function parseApplyVehicleFocusIntentToolArgs(input: string): ApplyVehicleFocusIntentToolArgs {
  const parsed = JSON.parse(input) as ApplyVehicleFocusIntentToolArgs;
  return {
    request: parsed.request,
    scope: parsed.scope === 'selection' ? 'selection' : 'asset'
  };
}

function parseSetVehicleViewModeToolArgs(input: string): SetVehicleViewModeToolArgs {
  const parsed = JSON.parse(input) as SetVehicleViewModeToolArgs;
  if (!['wireframe', 'xray', 'uv_debug', 'postprocess'].includes(parsed.mode)) {
    throw new OpenAIChatInputError('A valid vehicle view mode is required.');
  }

  return {
    mode: parsed.mode,
    enabled: parsed.enabled !== false
  };
}

function parseExpandVehicleSelectionToolArgs(input: string): ExpandVehicleSelectionToolArgs {
  const parsed = JSON.parse(input) as ExpandVehicleSelectionToolArgs;
  if (!['node', 'part', 'semantic_group'].includes(parsed.target)) {
    throw new OpenAIChatInputError('A valid selection expansion target is required.');
  }

  return {
    target: parsed.target,
    query: typeof parsed.query === 'string' ? parsed.query.trim() || undefined : undefined
  };
}

function parseAnnotateVehicleSemanticGroupToolArgs(
  input: string
): AnnotateVehicleSemanticGroupToolArgs {
  const parsed = JSON.parse(input) as AnnotateVehicleSemanticGroupToolArgs & { nodeId?: string };
  return {
    nodeIds: Array.isArray(parsed.nodeIds)
      ? parsed.nodeIds
      : typeof parsed.nodeId === 'string'
        ? [parsed.nodeId]
        : [],
    semanticGroup:
      typeof parsed.semanticGroup === 'string'
        ? parsed.semanticGroup.trim() || undefined
        : undefined,
    category: parsed.category,
    humanLabel: parsed.humanLabel,
    aliases: parsed.aliases
  };
}

function parseRefreshVehicleSemanticsToolArgs(input: string): RefreshVehicleSemanticsToolArgs {
  if (!input.trim()) {
    return {};
  }

  const parsed = JSON.parse(input) as RefreshVehicleSemanticsToolArgs;
  return {
    force: parsed.force === true
  };
}

function mergePatchOperations(
  current: FooterChatVehiclePatchOperation[],
  incoming: FooterChatVehiclePatchOperation[]
): FooterChatVehiclePatchOperation[] {
  const merged = new Map(
    current.map((operation) => [
      `${operation.targetType}:${operation.targetId}:${operation.op}`,
      operation
    ])
  );

  for (const operation of incoming) {
    merged.set(`${operation.targetType}:${operation.targetId}:${operation.op}`, operation);
  }

  return Array.from(merged.values());
}

async function restrictOperationsToSelection(
  activeAssetId: VehicleAssetId,
  selectedNodes: VehicleNodeSelection[],
  operations: FooterChatVehiclePatchOperation[]
): Promise<FooterChatVehiclePatchOperation[]> {
  const scopedSelections = selectedNodes.filter((selection) => selection.assetId === activeAssetId);
  if (scopedSelections.length === 0) {
    return [];
  }

  const structure = await deriveStructuralAssetSnapshot(activeAssetId);
  const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
  const meshById = new Map(structure.meshes.map((mesh) => [mesh.id, mesh]));
  const selectedNodeIds = new Set(scopedSelections.map((selection) => selection.nodeId));
  const selectedMaterialIds = new Set<string>();

  for (const selection of scopedSelections) {
    const node = nodeById.get(selection.nodeId);
    if (!node?.meshId) {
      continue;
    }

    const mesh = meshById.get(node.meshId);
    if (!mesh) {
      continue;
    }

    if (
      typeof selection.materialIndex === 'number' &&
      selection.materialIndex >= 0 &&
      selection.materialIndex < mesh.materialIds.length
    ) {
      selectedMaterialIds.add(mesh.materialIds[selection.materialIndex]!);
      continue;
    }

    if (selection.materialName) {
      mesh.materialIds.forEach((materialId, index) => {
        if (mesh.materialNames[index] === selection.materialName) {
          selectedMaterialIds.add(materialId);
        }
      });
      continue;
    }

    mesh.materialIds.forEach((materialId) => selectedMaterialIds.add(materialId));
  }

  return operations.filter((operation) => {
    if (operation.targetType === 'node') {
      return selectedNodeIds.has(operation.targetId);
    }

    if (operation.targetType === 'material') {
      return selectedMaterialIds.has(operation.targetId);
    }

    return false;
  });
}

async function attemptDirectVehicleEdit(
  input: NormalizedFooterChatRequest,
  model: string
): Promise<FooterChatResponse | null> {
  if (!input.assetId || !shouldAttemptDirectVehicleEdit(input)) {
    return null;
  }

  const result = await resolveVehicleIntent(input.assetId, input.message);
  const shouldScopeToSelection = shouldAttemptDirectSelectionEdit(input);
  const plannedOperations = shouldScopeToSelection
    ? await restrictOperationsToSelection(input.assetId, input.selectedNodes, result.operations)
    : result.operations;

  if (plannedOperations.length === 0) {
    return null;
  }

  const summary = shouldScopeToSelection
    ? `${result.summary} Scoped to selection.`
    : result.summary;

  return {
    model,
    message: {
      role: 'assistant',
      content: summary
    },
    vehiclePatchAssetId: input.assetId,
    vehiclePatchLabel: summary,
    vehiclePatchOperations: plannedOperations
  };
}

function summarizeRestoreInstruction(restore: FooterChatPresentationRestore): string {
  if (restore.restoreAll) {
    return 'Restored the vehicle to its original rendered state.';
  }

  const fragments: string[] = [];
  if (restore.viewerModes && restore.viewerModes.length > 0) {
    fragments.push(`disabled ${restore.viewerModes.join(', ')}`);
  }
  if (restore.hiddenTargetIds && restore.hiddenTargetIds.length > 0) {
    fragments.push(`restored ${restore.hiddenTargetIds.length} hidden node region(s)`);
  }
  if (restore.highlightedTargetIds && restore.highlightedTargetIds.length > 0) {
    fragments.push(`cleared ${restore.highlightedTargetIds.length} highlight region(s)`);
  }
  if (restore.materialTargetIds && restore.materialTargetIds.length > 0) {
    fragments.push(`restored ${restore.materialTargetIds.length} material region(s)`);
  }

  return fragments.length > 0
    ? `${fragments[0]!.charAt(0).toUpperCase()}${fragments[0]!.slice(1)}${fragments.length > 1 ? ` and ${fragments.slice(1).join(', ')}` : ''}.`
    : 'Restored the current presentation to the original rendered state.';
}

function buildViewModeRequest(args: SetVehicleViewModeToolArgs): string {
  const modeLabel =
    args.mode === 'uv_debug' ? 'uv debug' : args.mode === 'postprocess' ? 'postprocess' : args.mode;
  return `${args.enabled ? 'enable' : 'disable'} ${modeLabel}`;
}

async function expandVehicleSelection(
  activeAssetId: VehicleAssetId,
  selectedNodes: VehicleNodeSelection[],
  args: ExpandVehicleSelectionToolArgs
): Promise<{ selectedNodes: VehicleNodeSelection[]; label: string }> {
  const scopedSelections = selectedNodes.filter((selection) => selection.assetId === activeAssetId);
  if (scopedSelections.length === 0) {
    throw new OpenAIChatInputError('No selected runtime nodes are available to expand.');
  }

  const structure = await deriveStructuralAssetSnapshot(activeAssetId);
  const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
  const meshById = new Map(structure.meshes.map((mesh) => [mesh.id, mesh]));

  if (args.target === 'node') {
    const expandedSelections = scopedSelections.map((selection) => ({
      assetId: activeAssetId,
      nodeId: selection.nodeId,
      nodeName: selection.nodeName,
      nodePath: selection.nodePath
    }));

    return {
      selectedNodes: expandedSelections,
      label: 'Expanded selection to whole node.'
    };
  }

  const overlay = await readVehicleSemanticOverlay(activeAssetId);
  if (!overlay) {
    throw new OpenAIChatInputError('No semantic overlay is available to expand this selection.');
  }

  const selectedNodeIds = new Set(scopedSelections.map((selection) => selection.nodeId));
  const selectedMaterialIds = new Set<string>();
  for (const selection of scopedSelections) {
    const node = nodeById.get(selection.nodeId);
    if (!node?.meshId) {
      continue;
    }

    const mesh = meshById.get(node.meshId);
    if (!mesh) {
      continue;
    }

    if (
      typeof selection.materialIndex === 'number' &&
      selection.materialIndex >= 0 &&
      selection.materialIndex < mesh.materialIds.length
    ) {
      selectedMaterialIds.add(mesh.materialIds[selection.materialIndex]!);
      continue;
    }

    if (selection.materialName) {
      mesh.materialIds.forEach((materialId, index) => {
        if (mesh.materialNames[index] === selection.materialName) {
          selectedMaterialIds.add(materialId);
        }
      });
    }
  }

  const query = args.query?.toLowerCase();
  const candidateEntities =
    args.target === 'part'
      ? overlay.acceptedParts.filter((part) => {
        const matchesSelection =
          part.nodeIds.some((nodeId) => selectedNodeIds.has(nodeId)) ||
          part.materialIds.some((materialId) => selectedMaterialIds.has(materialId));
        if (!matchesSelection) {
          return false;
        }

        if (!query) {
          return true;
        }

        return `${part.id} ${part.humanLabel} ${part.aliases.join(' ')}`
          .toLowerCase()
          .includes(query);
      })
      : overlay.acceptedGroups.filter((group) => {
        const matchesSelection =
          group.nodeIds.some((nodeId) => selectedNodeIds.has(nodeId)) ||
          group.materialIds.some((materialId) => selectedMaterialIds.has(materialId));
        if (!matchesSelection) {
          return false;
        }

        if (!query) {
          return true;
        }

        return `${group.id} ${group.humanLabel} ${group.aliases.join(' ')}`
          .toLowerCase()
          .includes(query);
      });

  const bestEntity = candidateEntities.sort((left, right) => {
    const leftCoverage = left.nodeIds.length * 10 + left.materialIds.length;
    const rightCoverage = right.nodeIds.length * 10 + right.materialIds.length;
    if (leftCoverage !== rightCoverage) {
      return rightCoverage - leftCoverage;
    }

    return right.confidence - left.confidence;
  })[0];

  if (!bestEntity) {
    throw new OpenAIChatInputError(
      args.target === 'part'
        ? 'No semantic part matched the current selection.'
        : 'No semantic group matched the current selection.'
    );
  }

  const expandedNodeIds = Array.from(
    new Set([
      ...bestEntity.nodeIds,
      ...bestEntity.materialIds.flatMap(
        (materialId) =>
          structure.materials.find((material) => material.id === materialId)?.nodeIds ?? []
      )
    ])
  );

  const expandedSelections = expandedNodeIds
    .map((nodeId) => {
      const node = nodeById.get(nodeId);
      if (!node) {
        return null;
      }

      return {
        assetId: activeAssetId,
        nodeId,
        nodeName: node.name.trim() || nodeId,
        nodePath: node.path
      };
    })
    .filter((entry): entry is VehicleNodeSelection => entry !== null);

  if (expandedSelections.length === 0) {
    throw new OpenAIChatInputError(
      'Expanded semantic selection did not resolve any runtime nodes.'
    );
  }

  return {
    selectedNodes: expandedSelections,
    label:
      args.target === 'part'
        ? `Expanded selection to part ${bestEntity.humanLabel}.`
        : `Expanded selection to semantic group ${bestEntity.humanLabel}.`
  };
}

async function executeToolCall(
  toolCall: {
    id: string;
    function: { name: string; arguments: string };
  },
  activeAssetId?: VehicleAssetId,
  selectedNodes: VehicleNodeSelection[] = []
): Promise<ExecutedToolResult> {
  if (
    toolCall.function.name === APPLY_VEHICLE_APPEARANCE_INTENT_TOOL_NAME ||
    toolCall.function.name === LEGACY_APPLY_VEHICLE_PAINT_INTENT_TOOL_NAME ||
    toolCall.function.name === LEGACY_APPLY_VEHICLE_INTENT_TOOL_NAME
  ) {
    try {
      if (!activeAssetId) {
        throw new OpenAIChatInputError('No active vehicle asset is available for this request.');
      }

      if (toolCall.function.name === LEGACY_APPLY_VEHICLE_PAINT_INTENT_TOOL_NAME) {
        const args = parseApplyVehicleAppearanceIntentToolArgs(toolCall.function.arguments);
        if (!args.colorFamily) {
          throw new OpenAIChatInputError('A color family is required for normalized paint intent.');
        }

        const result = await planNormalizedVehiclePaintIntent(activeAssetId, {
          colorFamily: args.colorFamily,
          shade: args.shade,
          saturation: args.saturation,
          finish: args.finish,
          hex: args.hex
        });
        const plannedOperations =
          args.scope === 'selection'
            ? await restrictOperationsToSelection(activeAssetId, selectedNodes, result.operations)
            : result.operations;
        return {
          message: {
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              ...result,
              operations: plannedOperations,
              scope: args.scope
            })
          },
          plannedOperations,
          intentLabel:
            args.scope === 'selection' ? `${result.summary} Scoped to selection.` : result.summary
        };
      }

      const args = parseApplyVehicleAppearanceIntentToolArgs(toolCall.function.arguments);

      if (args.colorFamily && !args.request) {
        const result = await planNormalizedVehiclePaintIntent(activeAssetId, {
          colorFamily: args.colorFamily,
          shade: args.shade,
          saturation: args.saturation,
          finish: args.finish,
          hex: args.hex
        });
        const plannedOperations =
          args.scope === 'selection'
            ? await restrictOperationsToSelection(activeAssetId, selectedNodes, result.operations)
            : result.operations;
        return {
          message: {
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              ...result,
              operations: plannedOperations,
              scope: args.scope
            })
          },
          plannedOperations,
          intentLabel:
            args.scope === 'selection' ? `${result.summary} Scoped to selection.` : result.summary
        };
      }

      if (!args.request) {
        throw new OpenAIChatInputError(
          'A freeform appearance request or normalized paint fields are required.'
        );
      }

      const result = await resolveVehicleIntent(activeAssetId, args.request);
      const plannedOperations =
        args.scope === 'selection'
          ? await restrictOperationsToSelection(activeAssetId, selectedNodes, result.operations)
          : result.operations;
      return {
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            ...result,
            operations: plannedOperations,
            scope: args.scope
          })
        },
        plannedOperations,
        intentLabel:
          args.scope === 'selection' ? `${result.summary} Scoped to selection.` : result.summary
      };
    } catch (error) {
      return {
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: error instanceof Error ? error.message : 'Tool execution failed.'
          })
        }
      };
    }
  }

  if (toolCall.function.name === APPLY_VEHICLE_FOCUS_INTENT_TOOL_NAME) {
    try {
      const args = parseApplyVehicleFocusIntentToolArgs(toolCall.function.arguments);

      if (!activeAssetId) {
        throw new OpenAIChatInputError('No active vehicle asset is available for this request.');
      }

      const result = await resolveVehicleIntent(activeAssetId, args.request);
      const plannedOperations =
        args.scope === 'selection'
          ? await restrictOperationsToSelection(activeAssetId, selectedNodes, result.operations)
          : result.operations;
      return {
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            ...result,
            operations: plannedOperations,
            scope: args.scope
          })
        },
        plannedOperations,
        intentLabel:
          args.scope === 'selection' ? `${result.summary} Scoped to selection.` : result.summary
      };
    } catch (error) {
      return {
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: error instanceof Error ? error.message : 'Tool execution failed.'
          })
        }
      };
    }
  }

  if (toolCall.function.name === SET_VEHICLE_VIEW_MODE_TOOL_NAME) {
    try {
      const args = parseSetVehicleViewModeToolArgs(toolCall.function.arguments);

      if (!activeAssetId) {
        throw new OpenAIChatInputError('No active vehicle asset is available for this request.');
      }

      const request = buildViewModeRequest(args);
      const result = await resolveVehicleIntent(activeAssetId, request);
      return {
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            ...result,
            mode: args.mode,
            enabled: args.enabled
          })
        },
        plannedOperations: result.operations,
        intentLabel: result.summary
      };
    } catch (error) {
      return {
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: error instanceof Error ? error.message : 'Tool execution failed.'
          })
        }
      };
    }
  }

  if (toolCall.function.name === EXPAND_VEHICLE_SELECTION_TOOL_NAME) {
    try {
      if (!activeAssetId) {
        throw new OpenAIChatInputError(
          'No active vehicle asset is available for selection expansion.'
        );
      }

      const args = parseExpandVehicleSelectionToolArgs(toolCall.function.arguments);
      const expansion = await expandVehicleSelection(activeAssetId, selectedNodes, args);
      return {
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            target: args.target,
            query: args.query,
            selectedNodeCount: expansion.selectedNodes.length,
            label: expansion.label
          })
        },
        selectionUpdate: expansion.selectedNodes,
        selectionUpdateLabel: expansion.label
      };
    } catch (error) {
      return {
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: error instanceof Error ? error.message : 'Tool execution failed.'
          })
        }
      };
    }
  }

  if (toolCall.function.name === ANNOTATE_VEHICLE_SEMANTIC_GROUP_TOOL_NAME) {
    try {
      const args = parseAnnotateVehicleSemanticGroupToolArgs(toolCall.function.arguments);

      if (!activeAssetId) {
        throw new OpenAIChatInputError('No active vehicle asset is available for this request.');
      }

      if (args.nodeIds.length === 0) {
        throw new OpenAIChatInputError(
          'No selected runtime node IDs were provided for semantic annotation.'
        );
      }

      if (!args.semanticGroup && !args.category) {
        throw new OpenAIChatInputError(
          'A semantic group name or category is required for semantic annotation.'
        );
      }

      const scopedSelections = selectedNodes.filter(
        (selection) =>
          selection.assetId === activeAssetId && args.nodeIds.includes(selection.nodeId)
      );
      const overlay = await annotateVehicleSemanticGroup(activeAssetId, {
        ...args,
        materialSelections: scopedSelections.map((selection) => ({
          nodeId: selection.nodeId,
          materialIndex: selection.materialIndex,
          materialName: selection.materialName
        }))
      });
      return {
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            assetId: overlay.assetId,
            category: args.category,
            semanticGroup: args.semanticGroup,
            nodeIds: args.nodeIds,
            acceptedGroupCount: overlay.acceptedGroups.length
          })
        }
      };
    } catch (error) {
      return {
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: error instanceof Error ? error.message : 'Tool execution failed.'
          })
        }
      };
    }
  }

  if (toolCall.function.name === REFRESH_VEHICLE_SEMANTICS_TOOL_NAME) {
    try {
      const args = parseRefreshVehicleSemanticsToolArgs(toolCall.function.arguments);

      if (!activeAssetId) {
        throw new OpenAIChatInputError(
          'No active vehicle asset is available for semantic refresh.'
        );
      }

      const overlay = await generateVehicleSemanticOverlay(activeAssetId, {
        force: args.force === true
      });
      return {
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            assetId: overlay.assetId,
            generatedAt: overlay.generatedAt,
            structuralGeneratedAt: overlay.structuralGeneratedAt,
            acceptedMaterialCount: overlay.acceptedMaterials.length,
            discardedSuggestionCount: overlay.discardedSuggestions.length
          })
        }
      };
    } catch (error) {
      return {
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: error instanceof Error ? error.message : 'Tool execution failed.'
          })
        }
      };
    }
  }

  return {
    message: {
      role: 'tool',
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: `Unsupported tool: ${toolCall.function.name}` })
    }
  };
}

async function resolveSemanticOverlayState(
  input: NormalizedFooterChatRequest
): Promise<SemanticOverlayState> {
  if (!input.assetId) {
    return 'unknown';
  }

  if (!isSemanticRefreshRequest(input.message) && !requestNeedsSemanticGrounding(input.message)) {
    return 'unknown';
  }

  const capabilities = await deriveVehicleInspectionCapabilities(input.assetId);
  return getVehicleSemanticOverlayStatus(input.assetId, capabilities.generatedAt);
}

export async function createFooterChatResponse(
  input: FooterChatRequest
): Promise<FooterChatResponse> {
  const normalized = normalizeRequest(input);
  const model = env.OPENAI_MODEL || DEFAULT_MODEL;
  const toolChoice = getToolChoiceForRequest(normalized);

  try {
    if (toolChoice && !normalized.assetId) {
      return {
        model,
        message: {
          role: 'assistant',
          content: 'Select a vehicle asset first, then I can apply that edit.'
        }
      };
    }

    const presentationRestore = buildPresentationRestore(normalized);
    if (presentationRestore) {
      return {
        model,
        message: {
          role: 'assistant',
          content: summarizeRestoreInstruction(presentationRestore)
        },
        presentationRestore
      };
    }

    const directVehicleEditResponse = await attemptDirectVehicleEdit(normalized, model);
    if (directVehicleEditResponse) {
      return directVehicleEditResponse;
    }

    const openai = getClient();
    const semanticOverlayState = await resolveSemanticOverlayState(normalized);

    const messages = toOpenAIMessages(normalized, semanticOverlayState);
    let vehiclePatchOperations: FooterChatVehiclePatchOperation[] = [];
    let vehiclePatchLabel: string | undefined;
    let selectionUpdate: VehicleNodeSelection[] | undefined;
    let selectionUpdateLabel: string | undefined;
    let completion = await openai.chat.completions.create({
      model,
      messages,
      tools: CHAT_TOOLS,
      tool_choice: toolChoice
    });

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const assistantMessage = completion.choices[0]?.message;
      const toolCalls = assistantMessage?.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        break;
      }

      messages.push(assistantMessage);

      for (const toolCall of toolCalls) {
        if (toolCall.type !== 'function') {
          continue;
        }

        const toolResult = await executeToolCall(
          toolCall,
          normalized.assetId,
          normalized.selectedNodes
        );
        messages.push(toolResult.message);

        if (toolResult.plannedOperations && toolResult.plannedOperations.length > 0) {
          vehiclePatchOperations = mergePatchOperations(
            vehiclePatchOperations,
            toolResult.plannedOperations
          );
          vehiclePatchLabel = toolResult.intentLabel ?? vehiclePatchLabel;
        }

        if (toolResult.selectionUpdate && toolResult.selectionUpdate.length > 0) {
          selectionUpdate = toolResult.selectionUpdate;
          selectionUpdateLabel = toolResult.selectionUpdateLabel ?? selectionUpdateLabel;
        }
      }

      completion = await openai.chat.completions.create({
        model,
        messages,
        tools: CHAT_TOOLS
      });
    }

    const content = completion.choices[0]?.message?.content;
    const text = Array.isArray(content)
      ? content
        .map((part) => ('text' in part ? part.text : ''))
        .join('')
        .trim()
      : content?.trim();

    if (!text) {
      if (vehiclePatchOperations.length > 0) {
        return {
          model,
          message: {
            role: 'assistant',
            content: 'Applied the requested vehicle edit.'
          },
          vehiclePatchAssetId: normalized.assetId,
          vehiclePatchLabel,
          vehiclePatchOperations,
          selectionUpdate:
            selectionUpdate && selectionUpdate.length > 0
              ? {
                mode: 'replace',
                selectedNodes: selectionUpdate,
                label: selectionUpdateLabel
              }
              : undefined
        };
      }

      throw new OpenAIChatConfigError('OpenAI returned an empty response.');
    }

    if (vehiclePatchOperations.length === 0) {
      const fallbackVehicleEditResponse = await attemptDirectVehicleEdit(normalized, model);
      if (fallbackVehicleEditResponse) {
        return fallbackVehicleEditResponse;
      }
    }

    return {
      model,
      message: {
        role: 'assistant',
        content: text
      },
      vehiclePatchAssetId: vehiclePatchOperations.length > 0 ? normalized.assetId : undefined,
      vehiclePatchLabel:
        vehiclePatchOperations.length > 0 ? (vehiclePatchLabel ?? text) : undefined,
      vehiclePatchOperations:
        vehiclePatchOperations.length > 0 ? vehiclePatchOperations : undefined,
      selectionUpdate:
        selectionUpdate && selectionUpdate.length > 0
          ? {
            mode: 'replace',
            selectedNodes: selectionUpdate,
            label: selectionUpdateLabel
          }
          : undefined
    };
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      throw new OpenAIChatUpstreamError(error.message);
    }

    if (error instanceof OpenAIChatConfigError) {
      throw error;
    }

    throw new OpenAIChatUpstreamError(
      error instanceof Error ? error.message : 'OpenAI request failed.'
    );
  }
}
