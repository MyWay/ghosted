import { Repo } from '../db/repo';

/** UI pages only read (and edit settings); all scan writes happen in the background script. */
export const repo = new Repo();
