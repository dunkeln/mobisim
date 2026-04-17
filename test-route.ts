import { resolveIntentDraft } from './src/lib/server/connectors/openai-chat/intent-resolver';
import { shouldAttemptDirectVehicleEdit, classifyExecutionRoute } from './src/lib/server/connectors/openai-chat/routing';

const input = {
    assetId: '2017_lexus_lc_500',
    message: 'execute xray view for the vehicle lexus',
    selectedNodes: [],
    presentation: { highlightedTargets: [] },
    sidebar: { active: false, cards: [] },
    supplementaryList: { active: false, entries: {} }
};

const draft = resolveIntentDraft(input as any);
console.log('Draft domain:', draft.domain);

const shouldEdit = shouldAttemptDirectVehicleEdit(input as any);
console.log('shouldAttemptDirectVehicleEdit:', shouldEdit);

const route = classifyExecutionRoute(input as any);
console.log('classifyExecutionRoute:', route);
