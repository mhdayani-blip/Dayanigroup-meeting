import asyncio
import pathlib
import subprocess
import edge_tts

VOICE = "fa-IR-DilaraNeural"
RATE = "-16%"
OUT = pathlib.Path("tts-test-output")
OUT.mkdir(exist_ok=True)

segments = [
    ("امروز لازم نیست با عجله، روزم را شروع کنم.", 0.9),
    ("می‌توانم چند لحظه آرام بمانم، نفس بکشم، و اجازه بدهم ذهنم از شتاب فاصله بگیرد.", 0.9),
    ("برای فرصت تازه‌ی امروز، برای سلامتی، و برای توانایی فکر کردن و ساختن، سپاسگزارم.", 0.9),
    ("قرار نیست همه چیز همین حالا کامل باشد.", 0.8),
    ("کافی است با آرامش بیشتر، دقت بیشتر، و ذهنی روشن‌تر، قدم بعدی را درست بردارم.", 0.9),
    ("امروز انرژی‌ام را برای چیزهایی نگه می‌دارم که واقعاً ارزش دارند.", 0.8),
    ("با قدردانی شروع می‌کنم، با آرامش ادامه می‌دهم، و با عمل کردن می‌سازم.", 0.0),
]

def run(*args):
    subprocess.run(args, check=True)

async def synthesize():
    concat_entries = []

    for idx, (text, pause) in enumerate(segments, start=1):
        speech = OUT / f"speech_{idx:02d}.mp3"
        await edge_tts.Communicate(text=text, voice=VOICE, rate=RATE).save(str(speech))
        concat_entries.append(speech)

        if pause > 0:
            silence = OUT / f"silence_{idx:02d}.mp3"
            run(
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-f", "lavfi",
                "-i", "anullsrc=r=24000:cl=mono",
                "-t", str(pause),
                "-c:a", "libmp3lame", "-b:a", "64k",
                str(silence),
            )
            concat_entries.append(silence)

    concat_file = OUT / "concat.txt"
    concat_file.write_text(
        "\n".join(f"file '{p.name}'" for p in concat_entries),
        encoding="utf-8",
    )

    narration = OUT / "dilara-narration.m4a"
    run(
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "concat", "-safe", "0",
        "-i", str(concat_file),
        "-c:a", "aac", "-b:a", "192k",
        str(narration),
    )

    # A simple, fully generated ambient bed for testing mix balance.
    ambient = OUT / "ambient-bed.m4a"
    run(
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi",
        "-i",
        "aevalsrc=0.16*sin(2*PI*196*t)+0.11*sin(2*PI*246.94*t)+0.08*sin(2*PI*293.66*t):s=44100:d=45",
        "-af", "lowpass=f=1800,aecho=0.8:0.7:70|140:0.18|0.08,afade=t=in:st=0:d=1.5,afade=t=out:st=40:d=4",
        "-c:a", "aac", "-b:a", "160k",
        str(ambient),
    )

    mixed = OUT / "dilara-with-music-minus8db.m4a"
    run(
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(narration),
        "-i", str(ambient),
        "-filter_complex",
        "[1:a]volume=0.398[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=0[mix]",
        "-map", "[mix]",
        "-c:a", "aac", "-b:a", "192k",
        str(mixed),
    )

    run(
        "ffmpeg", "-hide_banner", "-i", str(narration),
        "-f", "null", "-"
    )

if __name__ == "__main__":
    asyncio.run(synthesize())
