Review the unstaged changes and untracked files using git status. Organize them into logical commit groups of 1 or more files, keeping in mind that you can only commit a file once.

For each group, output:
1. The `git add` command(s) for the files in that group
2. The commit message only — plain text (title + optional body). Do **not** wrap it in `git commit -m`, heredocs, or any shell. Output just the message text so the user can copy it.

Use `git status`, `git diff`, and other git inspection commands, but do NOT run `git add` nor `git commit` - only propose them.

**Exclude from all proposed groups:**
- **`notes.md`** — do not suggest commits for this file.
- **Paths in `.gitignore`** — do not suggest commits for any file or directory that is listed in or matched by a pattern in `.gitignore`. When in doubt, check `.gitignore` and exclude matching paths from every proposed group.

If the user provides additional instructions, follow them: $ARGUMENTS

## Guidelines

- Group related changes together (e.g., all migration files, all service changes for a feature)
- Keep commits focused and atomic
- Write commit messages that clearly explain what changed and why
- **ALWAYS** follow conventional commit format (see format specification below)
- Include context about the change in the commit message body when appropriate

## Commit Message Format Specification

**MANDATORY**: All commit messages MUST follow this exact format and style.

### Title Format

```
<type>(<scope>): <description>
```

**Rules:**
- **Type** (required): Use one of: `feat`, `fix`, `refactor`, `docs`, `style`, `perf`, `test`, `build`, `ci`, `chore`
- **Scope** (optional but recommended): The affected area/module (e.g., `api`, `db`, `scripts`, `webhooks`, `migrations`)
- **Description**: Use imperative mood ("add" not "added", "fix" not "fixed"), lowercase first letter, no period at end
- Keep title concise but descriptive (aim for 50-72 characters when possible)

### Body Format

The body is **optional** but **strongly recommended** for:
- Complex changes that need explanation
- Bug fixes that need context about the problem
- Features that need rationale or implementation details
- Changes that affect multiple areas

**Body Formatting Rules:**
- Use markdown-style formatting (bullet points with `-`, numbered lists with `1.`, etc.)
- Wrap lines at ~72 characters for readability
- Use blank lines to separate paragraphs
- Include context about why the change was made, not just what changed

## Output Format

**MANDATORY**: All commit messages MUST be outputted in markdown format with minimal formatting and a copy button for easy copy-paste.

### Output Structure

For each commit group, output:

1. **Git add command** in a markdown code block:
   ```bash
   git add <file1> <file2> ...
   ```

2. **Commit message** in a markdown code block with `text` language:
   ```text
   <type>(<scope>): <description>

   <optional body>
   ```
