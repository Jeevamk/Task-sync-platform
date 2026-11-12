/**
 * The parts of a Trello webhook payload we read.
 * Sent by Trello (not by our users), so it is a plain type, not a Swagger DTO.
 */
export interface TrelloWebhookBody {
  action?: {
    id: string;
    type: string;
    date: string;
    idMemberCreator?: string;
    memberCreator?: { fullName?: string };
    member?: { id?: string; fullName?: string };
    data?: {
      board?: { id: string };
      card?: { id: string; name?: string; desc?: string; idShort?: number; shortLink?: string; idList?: string; due?: string | null; closed?: boolean };
      list?: { id: string };
      listAfter?: { id: string };
      listBefore?: { id: string };
      old?: Record<string, unknown>;
      idMember?: string;
      text?: string;
    };
  };
}
