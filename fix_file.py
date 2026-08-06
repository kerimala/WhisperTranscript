with open("src/app/page.tsx", "r") as f:
    text = f.read()

# The error continues to say `</main >` with a space even though we just replaced it. 
# This means there are invisible characters or we didn't match the EOF correctly.
# Let's completely wipe the end of the file.

import re

# Find the start of the history side bar
start = text.find("{/* History Sidebar */}")
if start != -1:
    new_tail = """{/* History Sidebar */}
            {state === 'idle' && (
                <div className="w-full lg:w-80 shrink-0">
                    <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-6 sm:p-8 sticky top-6 max-h-[calc(100vh-48px)] flex flex-col">
                        <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                            <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Recent Transcriptions
                        </h2>

                        <div className="overflow-y-auto pr-2 flex-1 flex flex-col gap-3">
                            {history.length === 0 ? (
                                <p className="text-sm text-slate-500 italic text-center py-4">No saved transcriptions yet.</p>
                            ) : (
                                history.map((item) => (
                                    <button
                                        key={item.fileName}
                                        onClick={async () => {
                                            try {
                                                const res = await fetch(`/api/transcriptions/${item.fileName}`);
                                                if (res.ok) {
                                                    const data = await res.json();
                                                    setResult(data);
                                                    setState('complete');
                                                }
                                            } catch (err) {
                                                console.error("Failed to load past transcription:", err);
                                            }
                                        }}
                                        className="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all group flex flex-col gap-1"
                                    >
                                        <div className="font-medium text-slate-700 text-sm truncate group-hover:text-indigo-700">
                                            {item.originalName}
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-slate-500">
                                            <span>{new Date(item.created_at).toLocaleDateString()}</span>
                                            <span>{(item.sizeBytes / 1024).toFixed(1)} KB</span>
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
            </div>
        </main>
    );
}
"""
    new_text = text[:start] + new_tail
    
    with open("src/app/page.tsx", "w") as f:
        f.write(new_text)
    print("Replace successful")
else:
    print("Could not find start point")
