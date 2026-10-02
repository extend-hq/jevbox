import argparse
import ast
import collections
import concurrent.futures
import hashlib
import json
import pathlib
import tarfile
import urllib.parse
import urllib.request
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = ROOT / ".data" / "benchmarks"
SOURCES = BASE / "sources"
SEED = "jevbox-local-benchmarks-v1"
DATASETS = ["financebench", "qasper", "mmlongbench", "vidoseek", "longdocurl"]


def rank(value):
    return hashlib.sha256((SEED + value).encode()).hexdigest()


def download(url, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return path
    temporary = path.with_suffix(path.suffix + ".partial")
    request = urllib.request.Request(url, headers={"User-Agent": "Jevbox benchmark evaluation"})
    with urllib.request.urlopen(request, timeout=180) as response, temporary.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    temporary.replace(path)
    return path


def read(name):
    path = SOURCES / name
    if name.endswith("jsonl"):
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    return json.loads(path.read_text())


def metadata(dataset):
    urls = {
        "financebench": {
            "financebench.jsonl": "https://raw.githubusercontent.com/patronus-ai/financebench/main/data/financebench_open_source.jsonl",
            "financebench-documents.jsonl": "https://raw.githubusercontent.com/patronus-ai/financebench/main/data/financebench_document_information.jsonl",
            "financebench-tree.json": "https://api.github.com/repos/patronus-ai/financebench/git/trees/main?recursive=1",
        },
        "longdocurl": {
            "longdocurl.jsonl": "https://huggingface.co/datasets/dengchao/LongDocURL/resolve/main/LongDocURL_public_with_subtask_category.jsonl",
        },
        "vidoseek": {
            "vidoseek.json": "https://huggingface.co/datasets/autumncc/ViDoSeek/resolve/main/vidoseek.json",
        },
        "mmlongbench": {
            "mmlongbench.json": "https://raw.githubusercontent.com/mayubo2333/MMLongBench-Doc/main/data/samples.json",
        },
    }
    if dataset == "qasper":
        target = SOURCES / "qasper-official-test.json"
        if not target.exists():
            archive = download("https://qasper-dataset.s3.us-west-2.amazonaws.com/qasper-test-and-evaluator-v0.3.tgz", SOURCES / "qasper-original.tgz")
            with tarfile.open(archive, "r:gz") as tar:
                entry = next(entry for entry in tar if pathlib.PurePosixPath(entry.name).name == "qasper-test-v0.3.json")
                target.write_bytes(tar.extractfile(entry).read())
    else:
        for name, url in urls[dataset].items():
            download(url, SOURCES / name)


def reference(answer, evidence="", unanswerable=False):
    return {"answer": answer if isinstance(answer, str) else json.dumps(answer), "evidence": evidence, "unanswerable": unanswerable}


def candidates(dataset):
    questions = []
    documents = {}
    if dataset == "longdocurl":
        for item in read("longdocurl.jsonl"):
            doc = str(item["doc_no"])
            documents[doc] = {"title": doc + ".pdf", "expectedPages": item["total_pages"]}
            questions.append({"id": item["question_id"], "documentId": doc, "question": item["question"], "references": [reference(item["answer"], item.get("detailed_evidences", ""), item.get("answer_format") == "None")], "evidencePages": item["evidence_pages"], "type": item["task_tag"] + "/" + item["question_type"], "evidenceSources": item["evidence_sources"], "inputPageRange": item["start_end_idx"]})
    elif dataset == "financebench":
        info = {item["doc_name"]: item for item in read("financebench-documents.jsonl")}
        for item in read("financebench.jsonl"):
            doc = item["doc_name"]
            documents[doc] = {"title": doc + ".pdf", "url": info[doc]["doc_link"]}
            questions.append({"id": item["financebench_id"], "documentId": doc, "question": item["question"], "references": [reference(item["answer"], "\n\n".join(e["evidence_text"] for e in item["evidence"]))], "evidencePages": [e["evidence_page_num"] + 1 for e in item["evidence"]], "type": item["question_type"] + "/" + (item["question_reasoning"] or "unspecified"), "evidenceSources": ["Text/Table"]})
    elif dataset == "vidoseek":
        for item in read("vidoseek.json")["examples"]:
            meta = item["meta_info"]
            doc = meta["file_name"]
            documents[doc] = {"title": doc}
            questions.append({"id": item["uid"], "documentId": doc, "question": item["query"], "references": [reference(item["reference_answer"])], "evidencePages": meta["reference_page"], "type": meta["query_type"], "evidenceSources": [meta["source_type"]]})
    elif dataset == "mmlongbench":
        for index, item in enumerate(read("mmlongbench.json")):
            doc = item["doc_id"]
            documents[doc] = {"title": doc}
            sources = item["evidence_sources"]
            sources = ast.literal_eval(sources) if isinstance(sources, str) else sources
            pages = item["evidence_pages"]
            pages = ast.literal_eval(pages) if isinstance(pages, str) else pages
            unknown = item["answer"] in ["Not answerable", "Not Answerable", "Unanswerable"]
            questions.append({"id": str(index), "documentId": doc, "question": item["question"], "references": [reference(item["answer"], unanswerable=unknown)], "evidencePages": pages, "type": "unanswerable" if unknown else item["answer_format"], "evidenceSources": sources})
    elif dataset == "qasper":
        for doc, item in read("qasper-official-test.json").items():
            paragraphs = ["# " + item["title"], item["abstract"]]
            for section in item["full_text"]:
                paragraphs.extend(["## " + (section["section_name"] or "Section"), *section["paragraphs"]])
            paragraphs.extend(figure["caption"] for figure in item["figures_and_tables"])
            documents[doc] = {"title": item["title"], "content": "\n\n".join(paragraphs), "format": "text/markdown"}
            for qa in item["qas"]:
                references = []
                types = []
                for annotation in qa["answers"]:
                    answer = annotation["answer"]
                    if answer["unanswerable"]:
                        value, kind = "Unanswerable", "unanswerable"
                    elif answer["extractive_spans"]:
                        value, kind = ", ".join(answer["extractive_spans"]), "extractive"
                    elif answer["free_form_answer"]:
                        value, kind = answer["free_form_answer"], "abstractive"
                    else:
                        value, kind = ("Yes" if answer["yes_no"] else "No"), "boolean"
                    references.append(reference(value, "\n\n".join(answer["evidence"]), answer["unanswerable"]))
                    types.append(kind)
                questions.append({"id": qa["question_id"], "documentId": doc, "question": qa["question"], "references": references, "evidencePages": [], "type": "/".join(sorted(set(types))), "evidenceSources": ["Structured text"]})
    return documents, questions


def sample(dataset, documents, questions, count):
    by_document = collections.defaultdict(list)
    for question in questions:
        by_document[question["documentId"]].append(question)
    selected_documents = []
    pool = []
    strata = set(q["type"] for q in questions)
    covered = set()
    ordered = sorted(documents, key=lambda doc: rank(dataset + doc))
    while len(pool) < count or covered != strata:
        if not ordered:
            break
        needed = strata - covered
        doc = next((doc for doc in ordered if any(q["type"] in needed for q in by_document[doc])), ordered[0])
        ordered.remove(doc)
        selected_documents.append(doc)
        pool.extend(by_document[doc])
        covered.update(q["type"] for q in by_document[doc])
    groups = collections.defaultdict(list)
    for q in sorted(pool, key=lambda q: rank(dataset + q["id"])):
        groups[q["type"]].append(q)
    selected = []
    while len(selected) < min(count, len(pool)):
        for kind in sorted(groups):
            if groups[kind] and len(selected) < count:
                selected.append(groups[kind].pop(0))
    return {doc: documents[doc] for doc in selected_documents}, selected


def acquire(dataset, documents):
    target = BASE / dataset / "documents"
    target.mkdir(parents=True, exist_ok=True)
    if dataset == "longdocurl":
        archive = download("https://huggingface.co/datasets/dengchao/LongDocURL/resolve/main/pdf_files.tar.gz", SOURCES / "longdocurl-pdfs.tar.gz")
        with tarfile.open(archive, "r:gz") as tar:
            for entry in tar:
                name = pathlib.PurePosixPath(entry.name).name
                doc = name.removesuffix(".pdf")
                if entry.isfile() and doc in documents:
                    path = target / (doc + ".pdf")
                    if not path.exists():
                        path.write_bytes(tar.extractfile(entry).read())
                    documents[doc]["path"] = str(path)
    elif dataset == "vidoseek":
        archive = download("https://huggingface.co/datasets/autumncc/ViDoSeek/resolve/main/vidoseek_pdf_document.zip", SOURCES / "vidoseek-pdfs.zip")
        with zipfile.ZipFile(archive) as zipped:
            for entry in zipped.infolist():
                name = pathlib.PurePosixPath(entry.filename).name
                if name in documents:
                    path = target / name
                    if not path.exists():
                        path.write_bytes(zipped.read(entry))
                    documents[name]["path"] = str(path)
    else:
        finance_paths = {pathlib.PurePosixPath(item["path"]).name: item["path"] for item in read("financebench-tree.json")["tree"] if item["path"].endswith(".pdf")} if dataset == "financebench" else {}
        def one(pair):
            doc, meta = pair
            if dataset == "qasper":
                path = target / (doc + ".md")
                path.write_text(meta.pop("content"))
            else:
                path = target / meta["title"]
                if dataset == "financebench":
                    source = finance_paths.get(meta["title"])
                    url = "https://raw.githubusercontent.com/patronus-ai/financebench/main/" + urllib.parse.quote(source) if source else meta["url"]
                else:
                    url = "https://huggingface.co/datasets/yubo2333/MMLongBench-Doc/resolve/main/documents/" + urllib.parse.quote(meta["title"])
                download(url, path)
            meta["path"] = str(path)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            list(executor.map(one, documents.items()))
    missing = []
    for doc, meta in documents.items():
        if "path" not in meta:
            missing.append(doc)
            continue
        content = pathlib.Path(meta["path"]).read_bytes()
        meta.update({"id": doc, "sha256": hashlib.sha256(content).hexdigest(), "size": len(content), "mime": meta.get("format", "application/pdf")})
        if meta["mime"] == "application/pdf" and not content.startswith(b"%PDF-"):
            raise ValueError("Downloaded source is not a PDF")
    if missing:
        raise ValueError("Missing source documents: " + str(missing))


def prepare(dataset, count):
    metadata(dataset)
    documents, questions = candidates(dataset)
    total_documents, total_questions = len(documents), len(questions)
    documents, questions = sample(dataset, documents, questions, count)
    directory = BASE / dataset
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "questions.json").write_text(json.dumps(questions, indent=2))
    print(json.dumps({"dataset": dataset, "selectedQuestions": len(questions), "selectedDocuments": len(documents), "phase": "downloading"}), flush=True)
    acquire(dataset, documents)
    manifest = {"dataset": dataset, "seed": SEED, "availableDocuments": total_documents, "availableQuestions": total_questions, "selectedQuestions": len(questions), "sampling": "Deterministic document hashes, coverage of all question-type strata, round-robin questions by stratum. Original questions and answers are unchanged.", "protocol": "Complete source documents. LongDocURL input page windows are recorded but the local application receives the complete PDF. QASPER uses the released structured document text and captions, without annotations.", "documents": list(documents.values()), "sourceHashes": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in SOURCES.glob("*.json*") if p.is_file()}}
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps({"dataset": dataset, "selectedQuestions": len(questions), "documents": len(documents), "bytes": sum(d["size"] for d in documents.values()), "phase": "ready"}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("datasets", nargs="*", default=DATASETS)
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()
    if args.limit < 1:
        raise ValueError("The sample size must be positive")
    if any(dataset not in DATASETS for dataset in args.datasets):
        raise ValueError("Unknown dataset")
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        list(executor.map(lambda dataset: prepare(dataset, args.limit), args.datasets))
