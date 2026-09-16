# Local load profiles

The local web UI saves method load profiles here.

Real profile files live in `load-testing/load-profiles/local/` and are ignored by git.
Each profile defines API methods and the VUs assigned to each method.

Use the UI for normal work:

```bash
make ui
```

Manual run shape:

```bash
make profile CUSTOM_LOAD_PROFILE_FILE=load-testing/load-profiles/local/name.load.json
```
