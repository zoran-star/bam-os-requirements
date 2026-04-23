import { useState, useEffect, useRef, useCallback } from "react";

export function useVoiceInput({ onResult, onInterim, autoSubmitDelay = 2000 }) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const transcriptRef = useRef("");

  useEffect(() => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      setSupported(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      if (finalText) {
        const updated = (transcriptRef.current + " " + finalText).trim();
        transcriptRef.current = updated;
        setTranscript(updated);
      }
      if (onInterim) onInterim(interim);

      // Reset silence timer
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        if (transcriptRef.current) {
          recognition.stop();
          setIsListening(false);
          if (onResult) onResult(transcriptRef.current);
        }
      }, autoSubmitDelay);
    };

    recognition.onerror = (event) => {
      if (event.error !== "aborted") {
        console.warn("Speech recognition error:", event.error);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      clearTimeout(silenceTimerRef.current);
      try { recognition.stop(); } catch (e) { /* already stopped */ }
    };
  }, []);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    transcriptRef.current = "";
    setTranscript("");
    setIsListening(true);
    try {
      recognitionRef.current.start();
    } catch (e) {
      // Already started
    }
  }, []);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    setIsListening(false);
    clearTimeout(silenceTimerRef.current);
    try { recognitionRef.current.stop(); } catch (e) { /* already stopped */ }
    if (onResult && transcriptRef.current) {
      onResult(transcriptRef.current);
    }
  }, [onResult]);

  const resetTranscript = useCallback(() => {
    transcriptRef.current = "";
    setTranscript("");
  }, []);

  return { isListening, transcript, startListening, stopListening, resetTranscript, supported };
}
