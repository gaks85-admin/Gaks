import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card'; // Assume standard shadcn card
import { Button } from '../ui/button'; // Assume standard shadcn button

export default function TestModePage({ fetchWithAuth }: { fetchWithAuth: any }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const runWatcher = async () => {
    setIsRunning(true);
    setLogs(['Loading watcher...']);
    
    try {
      // In a real implementation, this would call the new API endpoint /api/watcher/test
      // const res = await fetchWithAuth('/api/watcher/test', { method: 'POST', body: JSON.stringify({ watcherId: '...' }) });
      setLogs(prev => [...prev, 'Running detector validator...', 'Running market structure...', 'Finished.']);
    } catch (err) {
      setLogs(prev => [...prev, `Error: ${err}`]);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test Mode</CardTitle>
      </CardHeader>
      <CardContent>
        <Button onClick={runWatcher} disabled={isRunning}>Run Watcher Now</Button>
        <div className="mt-4 p-4 bg-zinc-950 text-xs text-zinc-300 rounded font-mono">
            {logs.map((log, i) => <p key={i}>{log}</p>)}
        </div>
      </CardContent>
    </Card>
  );
}
