import {
    clearTranscriptionProgressForTests,
    getTranscriptionProgress,
    isValidTranscriptionProgressId,
    startTranscriptionProgress,
    updateTranscriptionProgress,
} from '../src/lib/transcription-progress';

describe('transcription progress registry', () => {
    const id = 'f6de7798-0e3a-4caa-9ef4-9f597a991a83';

    beforeEach(() => {
        clearTranscriptionProgressForTests();
    });

    it('accepts opaque browser IDs and rejects short or unsafe values', () => {
        expect(isValidTranscriptionProgressId(id)).toBe(true);
        expect(isValidTranscriptionProgressId('short')).toBe(false);
        expect(isValidTranscriptionProgressId('../not-safe-enough')).toBe(false);
    });

    it('tracks phase and worker progress without exposing mutable state', () => {
        startTranscriptionProgress(id, {
            stage: 'received',
            message: 'File received by server.',
            provider: 'groq',
            model: 'whisper-large-v3-turbo',
        });
        updateTranscriptionProgress(id, {
            stage: 'transcribing',
            message: 'Transcribing chunks.',
            totalChunks: 4,
            completedChunks: 1,
            activeWorkers: 2,
            workerLimit: 4,
        });

        const snapshot = getTranscriptionProgress(id);
        expect(snapshot).toMatchObject({
            id,
            stage: 'transcribing',
            totalChunks: 4,
            completedChunks: 1,
            activeWorkers: 2,
            workerLimit: 4,
        });
        expect(snapshot?.startedAt).toBeTruthy();
        expect(snapshot?.updatedAt).toBeTruthy();

        if (snapshot) snapshot.message = 'mutated outside registry';
        expect(getTranscriptionProgress(id)?.message).toBe('Transcribing chunks.');
    });
});
