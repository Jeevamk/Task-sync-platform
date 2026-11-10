import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectionsService } from '../connections/connections.service';

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  idShort: number;
  shortUrl: string;
  due: string | null;
  idMembers: string[];
  labels: { name: string; color: string | null }[];
  closed: boolean;
}

const CARD_FIELDS = 'id,name,desc,idList,idShort,shortUrl,due,idMembers,labels,closed';
const logger = new Logger('TrelloApi');

/** Trello REST API bound to ONE token (one customer's Trello account). */
export class TrelloApi {
  constructor(
    private readonly key: string,
    private readonly token: string,
  ) {}

  getMe(): Promise<{ id: string; fullName: string; username: string }> {
    return this.request('GET', '/members/me', { fields: 'id,fullName,username' });
  }

  getMember(idOrUsername: string): Promise<{ id: string; fullName: string; username: string }> {
    return this.request('GET', `/members/${encodeURIComponent(idOrUsername)}`, { fields: 'id,fullName,username' });
  }

  getMyBoards(): Promise<{ id: string; name: string; url: string }[]> {
    return this.request('GET', '/members/me/boards', { filter: 'open', fields: 'id,name,url' });
  }

  getBoard(idOrShortLink: string): Promise<{ id: string; name: string; url: string }> {
    return this.request('GET', `/boards/${encodeURIComponent(idOrShortLink)}`, { fields: 'id,name,url' });
  }

  getBoardMembers(boardId: string): Promise<{ id: string; fullName: string; username: string }[]> {
    return this.request('GET', `/boards/${boardId}/members`, { fields: 'id,fullName,username' });
  }

  getCard(cardId: string): Promise<TrelloCard> {
    return this.request('GET', `/cards/${cardId}`, { fields: CARD_FIELDS });
  }

  getBoardCards(boardId: string): Promise<TrelloCard[]> {
    return this.request('GET', `/boards/${boardId}/cards/open`, { fields: CARD_FIELDS });
  }

  getBoardLists(boardId: string): Promise<{ id: string; name: string; closed: boolean }[]> {
    return this.request('GET', `/boards/${boardId}/lists`, { fields: 'id,name,closed', filter: 'all' });
  }

  getBoardLabels(boardId: string): Promise<{ id: string; name: string; color: string | null }[]> {
    return this.request('GET', `/boards/${boardId}/labels`, { fields: 'id,name,color', limit: '1000' });
  }

  createCard(input: { idList: string; name: string; desc?: string; due?: string; idMembers?: string[]; idLabels?: string[] }): Promise<{
    id: string;
    shortUrl: string;
    idShort: number;
  }> {
    const params: Record<string, string> = { idList: input.idList, name: input.name, pos: 'bottom' };
    if (input.desc) params.desc = input.desc;
    if (input.due) params.due = input.due;
    if (input.idMembers?.length) params.idMembers = input.idMembers.join(',');
    if (input.idLabels?.length) params.idLabels = input.idLabels.join(',');
    return this.request('POST', '/cards', params);
  }

  async moveCard(cardId: string, listId: string): Promise<void> {
    await this.request('PUT', `/cards/${cardId}`, { idList: listId });
  }

  createWebhook(callbackURL: string, idModel: string, description: string): Promise<{ id: string }> {
    return this.request('POST', '/webhooks', { callbackURL, idModel, description });
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.request('DELETE', `/webhooks/${id}`);
  }

  listWebhooks(): Promise<{ id: string; idModel: string; callbackURL: string; active: boolean }[]> {
    return this.request('GET', `/tokens/${this.token}/webhooks`);
  }

  private async request<T = unknown>(method: string, path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`https://api.trello.com/1${path}`);
    url.searchParams.set('key', this.key);
    url.searchParams.set('token', this.token);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { method, signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    if (!res.ok) {
      logger.warn(`Trello ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
      throw new Error(`Trello ${method} ${path} failed: ${res.status} ${text.slice(0, 200)}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  }
}

/** Gives a TrelloApi for an organization (using that organization's own connected token). */
@Injectable()
export class TrelloClient {
  constructor(
    private readonly config: ConfigService,
    private readonly connections: ConnectionsService,
  ) {}

  async forOrg(organizationId: string): Promise<TrelloApi> {
    return this.withToken(await this.connections.getToken(organizationId, 'TRELLO'));
  }

  withToken(token: string): TrelloApi {
    return new TrelloApi(this.config.getOrThrow('TRELLO_API_KEY'), token);
  }

  /** Link that asks a customer to allow Task Sync on their Trello account. */
  authorizeUrl(returnUrl: string): string {
    const u = new URL('https://trello.com/1/authorize');
    u.searchParams.set('expiration', 'never');
    u.searchParams.set('name', 'Task Sync');
    u.searchParams.set('scope', 'read,write');
    u.searchParams.set('response_type', 'token');
    u.searchParams.set('key', this.config.getOrThrow('TRELLO_API_KEY'));
    u.searchParams.set('callback_method', 'fragment');
    u.searchParams.set('return_url', returnUrl);
    return u.toString();
  }
}
