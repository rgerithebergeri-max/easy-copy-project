import { useState, useCallback } from 'react';

export function usePlayerIdentity() {
  const [playerId] = useState(() => {
    const stored = localStorage.getItem('goryon-player-id');
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem('goryon-player-id', id);
    return id;
  });

  const [username, setUsernameState] = useState(
    () => localStorage.getItem('goryon-username') || ''
  );
  const [avatar, setAvatarState] = useState(
    () => localStorage.getItem('goryon-avatar') || 'goryon'
  );

  const setUsername = useCallback((name: string) => {
    localStorage.setItem('goryon-username', name);
    setUsernameState(name);
  }, []);

  const setAvatar = useCallback((av: string) => {
    localStorage.setItem('goryon-avatar', av);
    setAvatarState(av);
  }, []);

  return { playerId, username, setUsername, avatar, setAvatar };
}
