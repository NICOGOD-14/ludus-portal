"""Voz neural gratuita (edge-tts) con tiempos palabra por palabra.
Uso: python tts.py <voz> <velocidad ej +8%> <archivo_texto> <salida.mp3> <salida.json>
"""
import asyncio
import json
import sys

import edge_tts


async def main():
    voice, rate, text_file, out_mp3, out_json = sys.argv[1:6]
    with open(text_file, encoding="utf-8") as f:
        text = f.read()
    comm = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    words = []
    with open(out_mp3, "wb") as audio:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                audio.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / 1e7
                words.append({"start": round(start, 3), "end": round(start + chunk["duration"] / 1e7, 3), "text": chunk["text"]})
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False)


asyncio.run(main())
