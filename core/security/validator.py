"""Validate network targets against capabilities."""

import ipaddress

from .sanitizer import SecurityError


def validate_network_target(allowed_rules: list[str], target: str) -> None:
    """Check if target IP or domain is allowed.

    Args:
        allowed_rules: List of allowed CIDRs or domain patterns with optional * wildcard.
        target: IP address or domain name.

    Raises:
        SecurityError: If target not permitted.
    """
    # Try IP match
    try:
        target_ip = ipaddress.ip_address(target)
        for rule in allowed_rules:
            try:
                net = ipaddress.ip_network(rule, strict=False)
                if target_ip in net:
                    return
            except ValueError:
                continue
    except ValueError:
        pass

    # Domain match
    domain = target.lower()
    for rule in allowed_rules:
        if rule.startswith("*."):
            suffix = rule[2:]  # e.g. "example.com"
            # Wildcard matches subdomains only, not the root domain
            if domain.endswith("." + suffix):
                return
        elif rule == domain:
            return

    raise SecurityError(f"Network target '{target}' not allowed by capabilities")
