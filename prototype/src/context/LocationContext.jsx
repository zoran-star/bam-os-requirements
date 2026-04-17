import { createContext, useContext, useState, useEffect } from 'react';

const LocationContext = createContext();

export function LocationProvider({ children }) {
  const [location, setLocation] = useState(() => {
    try { return localStorage.getItem('fc_location') || 'all'; } catch { return 'all'; }
  });

  useEffect(() => {
    try { localStorage.setItem('fc_location', location); } catch {}
  }, [location]);

  return (
    <LocationContext.Provider value={{ location, setLocation }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  return useContext(LocationContext);
}
