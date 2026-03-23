import { createContext, useContext, useState } from 'react';

const LocationContext = createContext();

export function LocationProvider({ children }) {
  const [location, setLocation] = useState('all');
  return (
    <LocationContext.Provider value={{ location, setLocation }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  return useContext(LocationContext);
}
