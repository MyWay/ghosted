import { liveQuery } from 'dexie';
import { repo } from './repo';

export const FOLLOW_HANDLE = 'stackway24';
/** X's official follow intent: opens X's own confirmation dialog; the user decides. */
export const FOLLOW_URL = `https://x.com/intent/follow?screen_name=${FOLLOW_HANDLE}`;

const KEY = 'followPromptDone';

/** true once the user clicked Follow or dismissed the prompt anywhere; it never comes back. */
export const followPromptDone = liveQuery(() => repo.getSetting<boolean>(KEY, false));

export const markFollowPromptDone = () => repo.setSetting(KEY, true);
