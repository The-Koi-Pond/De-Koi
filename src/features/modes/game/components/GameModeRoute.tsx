import "../../../../styles/globals/08-game-cinematic-effects.css";
import { GameConversationView } from "./GameConversationView";

type GameModeRouteProps = {
  activeChatId: string;
};

export function GameModeRoute({ activeChatId }: GameModeRouteProps) {
  return <GameConversationView activeChatId={activeChatId} />;
}
