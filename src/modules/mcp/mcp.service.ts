import { OrgsService } from "../orgs/orgs.service";

export function asJson(data:unknown) {
    return { content: [{ type: 'text' as const, text:JSON.stringify(data, null, 2)}]}
}

export class McpService{
    constructor(private readonly orgs: OrgsService) {}
}