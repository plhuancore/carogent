export interface CommitHistoryItem {
  hash: string;
  parents: string[];
  decorations: string;
  subject: string;
  author: string;
  date: string;
  timestamp: number;
  isUncommitted?: boolean;
  isHEAD?: boolean;
}
