PYTHON ?= python
NPM ?= npm.cmd

.PHONY: install run test integration-test e2e check

install:
	$(PYTHON) -m pip install -r backend/requirements.txt

run:
	$(PYTHON) -m uvicorn backend.app.main:app --reload

test:
	$(PYTHON) -m pytest backend/tests -q

integration-test:
	$(PYTHON) -m pytest backend/integration_tests -q

e2e:
	cd e2e && $(NPM) test

check: test
