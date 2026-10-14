/** Open the agent instructions modal (owned by the header) from anywhere, e.g. the chat disclaimer. */
export const OPEN_AGENT_HELP = 'open-agent-help'
export const openAgentHelp = () => window.dispatchEvent(new Event(OPEN_AGENT_HELP))
