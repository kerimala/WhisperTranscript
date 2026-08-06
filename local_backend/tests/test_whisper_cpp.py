import unittest

from engines.whisper_cpp_engine import normalize_whisper_cpp_result


class WhisperCppNormalizationTests(unittest.TestCase):
    def test_current_transcription_shape_is_normalized(self):
        payload = {
            "result": {"language": "de"},
            "transcription": [
                {
                    "timestamps": {"from": "00:00:01,250", "to": "00:00:03,500"},
                    "text": " Hallo Welt ",
                }
            ],
        }

        result = normalize_whisper_cpp_result(payload, None)

        self.assertEqual(result["language"], "de")
        self.assertEqual(result["text"], "Hallo Welt")
        self.assertEqual(result["segments"][0]["start"], 1.25)
        self.assertEqual(result["segments"][0]["end"], 3.5)

    def test_numeric_offsets_are_ten_millisecond_ticks(self):
        payload = {
            "transcription": [
                {"offsets": {"from": 100, "to": 250}, "text": "test"},
            ]
        }
        result = normalize_whisper_cpp_result(payload, "en")
        self.assertEqual(result["segments"][0]["start"], 1.0)
        self.assertEqual(result["segments"][0]["end"], 2.5)


if __name__ == "__main__":
    unittest.main()
