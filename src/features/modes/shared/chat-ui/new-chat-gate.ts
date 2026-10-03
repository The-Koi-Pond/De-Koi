// Narrow entrypoint for the home screen: importing the full chat-ui barrel makes
// Rollup keep every chat component (and the generation engine behind them) on
// the home screen's load path, because their modules may have side effects.
export { NewChatConnectionGate } from "./components/NewChatConnectionGate";
