import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "Whisper Transcription | Audio to Text",
    description: "Transcribe audio files to text using selectable Whisper providers. Fast, accurate, and supports multiple audio formats.",
    keywords: ["transcription", "audio to text", "whisper", "speech recognition", "groq", "openai"],
    authors: [{ name: "Whisper For Files" }],
    openGraph: {
        title: "Whisper Transcription",
        description: "Fast audio transcription powered by selectable Whisper providers",
        type: "website",
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className="min-h-screen">
                {children}
            </body>
        </html>
    );
}
