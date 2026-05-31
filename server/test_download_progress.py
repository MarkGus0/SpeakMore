from download_progress import create_hf_tqdm_class


def test_hf_tqdm_class_reports_download_percent():
    events = []
    Tqdm = create_hf_tqdm_class(events.append)

    first = Tqdm(total=100)
    second = Tqdm(total=300)

    first.update(40)
    second.update(60)

    assert events[-1] == {
        "downloaded_bytes": 100,
        "total_bytes": 400,
        "progress_percent": 25,
    }

    first.update(60)
    second.update(240)

    assert events[-1] == {
        "downloaded_bytes": 400,
        "total_bytes": 400,
        "progress_percent": 100,
    }

    first.close()
    second.close()
