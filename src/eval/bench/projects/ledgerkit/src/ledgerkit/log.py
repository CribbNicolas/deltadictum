"""key=value log lines on standard error."""

import re
import sys

_IBAN = re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{8,30}\b")


def mask_iban(text: str) -> str:
    """Replace all but the last four characters of every IBAN-shaped token with '*'."""
    return _IBAN.sub(lambda m: "*" * (len(m.group()) - 4) + m.group()[-4:], text)


def _value(v) -> str:
    s = str(v)
    if s == "" or any(c in s for c in ' \t"='):
        return '"' + s.replace('"', '\\"') + '"'
    return s


def _write(level: str, msg: str, **kv) -> None:
    parts = [f"level={level}", f'msg="{msg}"'] + [f"{k}={_value(v)}" for k, v in kv.items()]
    sys.stderr.write(" ".join(parts) + "\n")


def info(msg: str, **kv) -> None:
    _write("info", msg, **kv)


def warn(msg: str, **kv) -> None:
    _write("warn", msg, **kv)


def error(msg: str, **kv) -> None:
    _write("error", msg, **kv)
