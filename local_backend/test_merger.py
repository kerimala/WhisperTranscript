import unittest

from local_backend.merger import merge_timed_items


class MergeTimedItemsTests(unittest.TestCase):
    def test_assigns_words_by_overlap_and_groups_consecutive_speakers(self):
        words = [
            {"word": "Hello", "start_ms": 0, "end_ms": 400},
            {"word": "there.", "start_ms": 400, "end_ms": 900},
            {"word": "Hi", "start_ms": 1000, "end_ms": 1200},
        ]
        turns = [(0.0, 0.95, "SPEAKER_00"), (0.95, 1.4, "SPEAKER_01")]

        self.assertEqual(
            merge_timed_items(words, turns),
            [
                {
                    "index": 0,
                    "start_ms": 0,
                    "end_ms": 900,
                    "text": "Hello there.",
                    "speaker": "SPEAKER_00",
                },
                {
                    "index": 1,
                    "start_ms": 1000,
                    "end_ms": 1200,
                    "text": "Hi",
                    "speaker": "SPEAKER_01",
                },
            ],
        )

    def test_uses_greatest_overlap_for_a_word_crossing_a_boundary(self):
        words = [{"word": "boundary", "start_ms": 800, "end_ms": 1200}]
        turns = [(0.0, 0.9, "A"), (0.9, 2.0, "B")]

        self.assertEqual(merge_timed_items(words, turns)[0]["speaker"], "B")

    def test_marks_unaligned_words_unknown(self):
        words = [{"word": "after", "start_ms": 2000, "end_ms": 2300}]

        self.assertEqual(merge_timed_items(words, [(0.0, 1.0, "A")])[0]["speaker"], "Unknown")


if __name__ == "__main__":
    unittest.main()
