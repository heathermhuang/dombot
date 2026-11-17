// Local presentation fixture. It renders the real form and dialog components;
// Save only updates local React state and never invokes a registrar/API.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { UrlForwardingEditor } from '../src/renderer/components/domains/UrlForwardingEditor';
import { validateUrlForwards } from '../src/renderer/lib/forwarding-input';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../src/renderer/components/ui/dialog';
import { Button } from '../src/renderer/components/ui/button';
import type { UrlForwardInput } from '../src/shared/ipc';

function Fixture() {
  const [rows, setRows] = useState<UrlForwardInput[]>([
    {
      host: '@',
      url: 'https://destination.example/a-long-path',
      type: 'permanent',
    },
    {
      host: 'www',
      url: 'https://destination.example/another-path',
      type: 'temporary',
    },
    {
      host: 'docs',
      url: 'https://destination.example/documentation',
      type: 'permanent',
    },
  ]);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(true);
  return (
    <main>
      <h1>Local forwarding form qualification</h1>
      <p>Only synthetic values. No provider requests or DNS changes.</p>
      <Button onClick={() => setOpen(true)}>Open forwarding form</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>URL forwarding</DialogTitle>
          <DialogDescription>
            Local form geometry fixture. Save records no provider change.
          </DialogDescription>
          <UrlForwardingEditor
            rows={rows}
            onChange={(value) => {
              setRows(value);
              setSaved(false);
            }}
            validation={validateUrlForwards(rows)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => setSaved(true)}
              disabled={validateUrlForwards(rows).errors.length > 0}
            >
              Save local draft
            </Button>
          </DialogFooter>
          {saved && (
            <p role="status">
              Local draft saved; no provider request was made.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
