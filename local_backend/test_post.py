import requests

with open("test_audio.wav", "wb") as f:
    f.write(b"RIFF" + b"\x00"*40)  # fake wav just to pass validation maybe, or we can use ffmpeg to create a real 1s wav

