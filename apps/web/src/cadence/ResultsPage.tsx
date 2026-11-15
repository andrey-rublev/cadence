import { ArrowLeft } from 'lucide-react'

import { Shell } from '@/components/Shell'
import { ModelResults } from '@/product/EvidenceCards'

/** How each model did on people it never saw. Kept off the dashboard, one link away. */
export function ResultsPage() {
  return (
    <Shell>
      <div className="grid gap-10">
        <div className="grid gap-3">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 justify-self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back
          </a>
          <h1 className="text-3xl">Measured results</h1>
          <p className="max-w-2xl text-muted-foreground">
            Each model was trained on a public research dataset and tested on people it never saw. Ranges are 95%
            intervals. None has been calibrated on people using Cadence yet.
          </p>
        </div>
        <ModelResults />
      </div>
    </Shell>
  )
}
