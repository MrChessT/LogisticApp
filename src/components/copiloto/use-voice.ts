"use client";

// Dictado por voz con el reconocimiento del navegador (Web Speech API, es-ES). Lo dicho se entrega como
// texto para revisarlo antes de enviar. Donde el navegador no lo tiene, `available` es false.
import { useRef, useState } from "react";

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function useVoice(onText: (text: string) => void, onEnd: () => void) {
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);

  function toggle() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "es-ES";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => onText(Array.from(e.results).map((r) => r[0]?.transcript ?? "").join(" ").trim());
    rec.onend = () => {
      setListening(false);
      recognition.current = null;
      onEnd();
    };
    rec.onerror = () => setListening(false);
    recognition.current = rec;
    setListening(true);
    rec.start();
  }

  return { listening, toggle, available: Boolean(recognitionCtor()) };
}
