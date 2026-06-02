from download_progress import create_hf_tqdm_class


def test_hf_tqdm_class_reports_download_percent():
    events = []
    Tqdm = create_hf_tqdm_class(events.append)

    first = Tqdm(total=100, unit="B")
    second = Tqdm(total=300, unit="B")

    first.update(40)
    second.update(60)

    assert events[-1] == {
        "downloaded_bytes": 100,
        "total_bytes": 400,
        "progress_percent": 25,
        "downloaded_files": 0,
        "total_files": 0,
        "file_progress_percent": None,
    }

    first.update(60)
    second.update(240)

    assert events[-1] == {
        "downloaded_bytes": 400,
        "total_bytes": 400,
        "progress_percent": 100,
        "downloaded_files": 0,
        "total_files": 0,
        "file_progress_percent": None,
    }

    first.close()
    second.close()


def test_hf_tqdm_class_does_not_report_file_count_as_bytes():
    events = []
    Tqdm = create_hf_tqdm_class(events.append)

    files = Tqdm(total=29, desc="Fetching 29 files")
    files.update(26)

    assert events[-1] == {
        "downloaded_bytes": 0,
        "total_bytes": 0,
        "progress_percent": None,
        "downloaded_files": 26,
        "total_files": 29,
        "file_progress_percent": 90,
    }

    files.close()
