import type { WorkerInput } from './types';
import { runChunk } from './simulation';

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const { deckList, turn1Cats, turn2Cats, numExtras, chunkSize, noptCards, going2nd, cardHash } = e.data;
  const result = runChunk(
    deckList, turn1Cats, turn2Cats, numExtras, chunkSize,
    new Set(noptCards), going2nd, cardHash,
  );
  self.postMessage(result);
};
