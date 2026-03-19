import Upscaler from './components/Upscaler'

export default function App() {
  return (
    <div className="min-h-screen bg-comfy-bg flex flex-col">
      {/* Header */}
      <header className="border-b border-comfy-border bg-comfy-panel px-6 py-3 flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-comfy-accent" />
        <span className="text-comfy-fg text-sm font-medium tracking-widest uppercase">
          ComfyUI Workflow UI
        </span>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-start justify-center p-8">
        <div className="w-full max-w-2xl">
          <Upscaler />
        </div>
      </main>
    </div>
  )
}
