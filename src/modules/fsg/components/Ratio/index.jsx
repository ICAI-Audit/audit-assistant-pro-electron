import React from 'react'
import Form3CD from './Form3CD'
import StatutoryRatios from './StatutoryRatios'
import AnalyticalRatios from './AnalyticalRatios'

// Features > Ratio has three screens (App.jsx 'Ratio: ...' leaves):
//   form26     - Form 26 (Old Name - 3CD): turnover, GP, NP, stock and material ratios
//   statutory  - Company Additional Disclosure Ratio (Schedule III, same as Policy)
//   analytical - Analytical Ratios for financial analysis
export default function Ratio({ view = 'form26', entity, activeTB, prevTB, activeRsId, onPrevTBChange }) {
  if (view === 'statutory') return <StatutoryRatios entity={entity} activeTB={activeTB} prevTB={prevTB} activeRsId={activeRsId} />
  if (view === 'analytical') return <AnalyticalRatios entity={entity} activeTB={activeTB} prevTB={prevTB} activeRsId={activeRsId} />
  return (
    <Form3CD
      entity={entity}
      activeTB={activeTB}
      prevTB={prevTB}
      onPrevTBChange={onPrevTBChange}
    />
  )
}
