"""Categorization rules: an ordered list of {match, category}, the first match wins."""

import json
import os

DEFAULT = os.path.join(os.path.dirname(__file__), "data", "default_rules.json")


def load(path: str) -> list:
    """The rules in path, or the default rules when the book has none."""
    with open(path if os.path.exists(path) else DEFAULT, encoding="utf-8") as f:
        return json.load(f)


def categorize(rules: list, description: str) -> str:
    text = description.lower()
    for rule in rules:
        if rule["match"] == "*" or rule["match"].lower() in text:
            return rule["category"]
    return "uncategorized"


def add(rules: list, match: str, category: str) -> list:
    """The rules with a new one before the catch-all."""
    rest = [r for r in rules if r["match"] != "*"]
    catch_all = [r for r in rules if r["match"] == "*"]
    return rest + [{"match": match, "category": category}] + catch_all
