import * as React from 'react'

// Overlays must stay in the same shadow root as their triggers and theme.
export const PortalContainer = React.createContext<HTMLElement | null>(null)
