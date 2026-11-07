"""Version of the running application, shared by the API and OpenAPI."""
import os
import re

VERSION = "1.5.2"
_revision = os.getenv("BM_BUILD_REVISION", "")
REVISION = _revision if re.fullmatch(r"[a-fA-F0-9]{7,40}", _revision) else ""
