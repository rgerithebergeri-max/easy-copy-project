import goryonLogo from '@/assets/goryonlogo.jpg';
import chico from '@/assets/avatars/chico.jpg';
import cat from '@/assets/avatars/cat.png';
import patrik from '@/assets/avatars/patrik.jpg';
import judy from '@/assets/avatars/judy.jpg';
import anime from '@/assets/avatars/anime.jpg';
import spongebob from '@/assets/avatars/spongebob.jpg';
import goryonfejmc from '@/assets/avatars/goryonfejmc.png';
import shrek from '@/assets/avatars/shrek.jpg';
import krisz from '@/assets/avatars/krisz.png';
import orr from '@/assets/avatars/orr.png';

export interface AvatarOption {
  id: string;
  src: string;
  name: string;
}

export const AVATARS: AvatarOption[] = [
  { id: 'goryon', src: goryonLogo, name: 'GoryON' },
  { id: 'chico', src: chico, name: 'Chico' },
  { id: 'cat', src: cat, name: 'Macska' },
  { id: 'patrik', src: patrik, name: 'Patrik' },
  { id: 'judy', src: judy, name: 'Judy' },
  { id: 'anime', src: anime, name: 'Anime' },
  { id: 'spongebob', src: spongebob, name: 'SpongeBob' },
  { id: 'goryonfejmc', src: goryonfejmc, name: 'GoryON MC' },
  { id: 'shrek', src: shrek, name: 'Shrek' },
  { id: 'krisz', src: krisz, name: 'Krisz' },
  { id: 'orr', src: orr, name: 'Orr' },
];

export function getAvatarDisplay(avatarId: string): { src?: string; emoji?: string } {
  const av = AVATARS.find(a => a.id === avatarId);
  if (!av) return { emoji: '👤' };
  if (av.src) return { src: av.src };
  return { emoji: av.name };
}
