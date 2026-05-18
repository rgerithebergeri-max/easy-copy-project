import { useState } from 'react';
import { GameEntry, Player } from '@/lib/gameTypes';
import { getAvatarDisplay } from '@/lib/avatars';
import { playClick } from '@/lib/sounds';
import vitaCoco from '@/assets/reactions/vitacoco.jpg';
import { getSlideEntry } from '@/lib/gameFlow';

const REACTIONS = ['😂', '🔥', '❤️', '👏', '😱', '💀', '🤮', '🎨'];

interface Props {
  entries: GameEntry[];
  slide: { chain: number; step: number };
  players: Player[];
  playerOrder: string[];
  totalSteps: number;
  isHost: boolean;
  reactions: Array<{ id: string; type: string; x: number; y: number }>;
  onNextSlide: () => void;
  onPrevSlide: () => void;
  onSendReaction: (type: string) => void;
  onSendComment: (text: string) => void;
  onNewGame: () => void;
}

export default function AlbumView({
  entries, slide, players, playerOrder, totalSteps, isHost,
  reactions, onNextSlide, onPrevSlide, onSendReaction, onSendComment, onNewGame,
}: Props) {
  const [comment, setComment] = useState('');

  const currentEntry = getSlideEntry(entries, slide.chain, slide.step);

  const chainStarter = playerOrder[slide.chain];
  const chainStarterPlayer = players.find((p) => p.player_id === chainStarter);

  const isLastSlide = slide.chain >= playerOrder.length - 1 && slide.step >= totalSteps - 1;
  const isFirstSlide = slide.chain === 0 && slide.step === 0;

  const handleComment = () => {
    if (!comment.trim()) return;
    onSendComment(comment.trim());
    setComment('');
  };

  return (
    <div className="flex flex-col lg:flex-row gap-3 p-3 max-w-7xl mx-auto w-full relative h-[calc(100vh-80px)] overflow-hidden">
      {/* Floating reactions */}
      {reactions.map((r) => (
        <div
          key={r.id}
          className="fixed text-5xl animate-float-up pointer-events-none z-50"
          style={{ left: `${r.x}%`, top: `${r.y}%` }}
        >
          {r.type === 'vitacoco' ? (
            <img src={vitaCoco} alt="Vita Coco" className="w-12 h-12 rounded" />
          ) : (
            r.type
          )}
        </div>
      ))}

      {/* Main album area */}
      <div className="flex-1 flex flex-col items-center gap-2 min-h-0">
        {/* Chain info */}
        <div className="game-card w-full text-center py-1.5 px-3">
          <p className="text-xs text-muted-foreground">
            Lánc {slide.chain + 1}/{playerOrder.length} • Lépés {slide.step + 1}/{totalSteps} • Kezdte: <span className="text-primary font-bold">{chainStarterPlayer?.username || '?'}</span>
          </p>
        </div>

        {/* Current entry */}
        <div className="album-slide w-full max-w-3xl flex-1 min-h-0 flex flex-col">
          {currentEntry ? (
            <div className="p-3 flex flex-col flex-1 min-h-0">
              {/* Author */}
              <div className="flex items-center gap-2 mb-2 flex-shrink-0">
                {(() => {
                  const player = players.find((p) => p.player_id === currentEntry.player_id);
                  const av = getAvatarDisplay(player?.avatar || 'goryon');
                  return (
                    <>
                      {av.src ? (
                        <img src={av.src} alt="" className="w-7 h-7 rounded-lg border border-border object-cover" />
                      ) : (
                        <span className="w-7 h-7 rounded-lg border border-border flex items-center justify-center bg-card text-sm">
                          {av.emoji}
                        </span>
                      )}
                      <span className="font-bold text-sm">{currentEntry.player_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {currentEntry.entry_type === 'text' ? '✏️ Szöveg' : '🎨 Rajz'}
                      </span>
                    </>
                  );
                })()}
              </div>

              {/* Content */}
              {currentEntry.entry_type === 'text' ? (
                <div className="flex-1 flex items-center justify-center min-h-0">
                  <p className="text-2xl md:text-4xl font-bold animate-bounce-in text-center px-4">"{currentEntry.content}"</p>
                </div>
              ) : (
                <div className="flex-1 min-h-0 flex items-center justify-center border-2 border-border rounded-xl overflow-hidden bg-white">
                  <img src={currentEntry.content} alt="Rajz" className="max-w-full max-h-full object-contain" />
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              <p className="text-xl">Nincs bejegyzés</p>
            </div>
          )}
        </div>

        {/* Navigation (host only) */}
        {isHost && (
          <div className="flex items-center gap-3">
            <button
              className="game-btn-secondary"
              onClick={onPrevSlide}
              disabled={isFirstSlide}
            >
              ⬅️ Előző
            </button>

            {isLastSlide ? (
              <button className="game-btn-primary" onClick={onNewGame}>
                🔄 ÚJ JÁTÉK
              </button>
            ) : (
              <button className="game-btn-primary" onClick={onNextSlide}>
                Következő ➡️
              </button>
            )}
          </div>
        )}

        {/* Reactions + Comment */}
        <div className="flex-shrink-0 w-full flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-1 flex-wrap justify-center">
            {REACTIONS.map((r) => (
              <button key={r} className="text-2xl hover:scale-125 transition-transform active:scale-90 cursor-pointer" onClick={() => onSendReaction(r)}>{r}</button>
            ))}
            <button className="hover:scale-125 transition-transform active:scale-90 cursor-pointer" onClick={() => onSendReaction('vitacoco')}>
              <img src={vitaCoco} alt="Vita Coco" className="w-8 h-8 rounded" />
            </button>
          </div>
          <div className="flex items-center gap-2 w-full max-w-md">
            <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleComment()} className="game-input text-xs py-1.5" placeholder="Írj megjegyzést..." maxLength={100} />
            <button className="game-btn-primary text-xs py-1.5 px-3" onClick={handleComment} disabled={!comment.trim()}>💬</button>
          </div>
        </div>
      </div>

      {/* Right sidebar - Players */}
      <div className="game-card lg:w-56 flex-shrink-0 overflow-y-auto max-h-full">

        <h3 className="font-bold text-center mb-3">🏆 NÉVSOR</h3>
        <div className="flex flex-col gap-2">
          {playerOrder.map((pid, i) => {
            const player = players.find((p) => p.player_id === pid);
            const av = getAvatarDisplay(player?.avatar || 'goryon');
            const isChainStarter = i === slide.chain;
            return (
              <div
                key={pid}
                className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
                  isChainStarter ? 'bg-primary/20 border-2 border-primary' : 'border border-border/20'
                }`}
              >
                {av.src ? (
                  <img src={av.src} alt="" className="w-7 h-7 rounded object-cover" />
                ) : (
                  <span className="w-7 h-7 rounded flex items-center justify-center text-sm bg-card border border-border">
                    {av.emoji}
                  </span>
                )}
                <span className={`font-bold text-sm truncate ${isChainStarter ? 'text-primary' : ''}`}>
                  {player?.username || 'Ismeretlen'}
                </span>
                {isChainStarter && <span className="text-xs">🎬</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
