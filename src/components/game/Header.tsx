import goryonLogo from '@/assets/goryonlogo.jpg';
import FlashCommandoSwitch from './FlashCommandoSwitch';
import YouTubeMusicPlayer from './YouTubeMusicPlayer';

interface HeaderProps {
  musicActive?: boolean;
}

export default function Header({ musicActive = true }: HeaderProps) {
  return (
    <header className="relative w-full overflow-hidden">
      {/* Flash Commando Switch */}
      <div className="absolute top-2 left-2 md:top-3 md:left-4 z-20 scale-90 md:scale-100 origin-top-left">
        <FlashCommandoSwitch />
      </div>

      {/* Music toggle */}
      <div className="absolute top-2 right-2 md:top-3 md:right-32 z-20 scale-90 md:scale-100 origin-top-right">
        <YouTubeMusicPlayer videoId="9a6gQtlCzyY" label="Lobby zene" active={musicActive} autoStart />
      </div>

      {/* YouTube link */}
      <a
        href="https://www.youtube.com/@GoryON"
        target="_blank"
        rel="noopener noreferrer"
        className="hidden md:flex absolute top-3 right-4 z-20 items-center gap-1 game-btn-secondary text-sm py-1 px-3"
        onClick={() => {}}
      >
        <svg viewBox="0 0 24 24" className="w-6 h-6 fill-destructive" xmlns="http://www.w3.org/2000/svg">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
        </svg>
        <span className="font-bold">GoryON</span>
      </a>

      {/* Logo */}
      <div className="flex justify-center pt-14 md:pt-3 pb-1">
        <div className="flex items-center gap-3">
          <img src={goryonLogo} alt="GoryON" className="w-16 h-16 rounded-xl border-2 border-border shadow-lg" />
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            <span className="text-foreground">Goryon</span>
            <span className="text-primary"> Phone</span>
          </h1>
        </div>
      </div>

      {/* Scrolling banner */}
      <div className="relative h-8 overflow-hidden bg-primary/20 border-y-2 border-border">
        <div className="animate-marquee whitespace-nowrap flex items-center h-full gap-4">
          <span className="text-lg font-bold">✈️ Iratkozz fel Goryonra! ✈️</span>
          <span className="text-lg font-bold">🎮 Goryon Phone - A legjobb rajzolós parti játék! 🎨</span>
          <span className="text-lg font-bold">✈️ Iratkozz fel Goryonra! ✈️</span>
          <span className="text-lg font-bold">🎮 Goryon Phone - A legjobb rajzolós parti játék! 🎨</span>
        </div>
      </div>
    </header>
  );
}
