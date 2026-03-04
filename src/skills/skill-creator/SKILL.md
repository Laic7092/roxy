---
name: skill-creator
description: Create, modify, and optimize skills.
---

# Skill Creator

Skills are stored as `SKILL.md` files in the `skills/` directory.

## Create a Skill

```bash
# 1. Create directory
mkdir -p skills/{skill-name}

# 2. Create SKILL.md
cat > skills/{skill-name}/SKILL.md << 'EOF'
---
name: {skill-name}
description: {Brief description}
---

# {Skill Name}

{Skill instructions}
EOF
```

## SKILL.md Format

```markdown
---
name: my-skill
description: What this skill does
always: false  # optional
---

# Skill Name

Instructions and examples.
```

## Description Optimization

A well-crafted description improves skill triggering:

1. **Be specific**: Include key use cases
2. **Use keywords**: Add terms users might search for
3. **Test triggering**: Verify the skill activates for intended queries

**Example:**
```yaml
# Before
description: Work with files

# After
description: Create, read, update, and delete files. Supports txt, md, json, csv.
```

## Best Practices

- Use lowercase with hyphens: `my-skill`
- Write clear descriptions for discoverability
- Keep skills focused on one domain
- Test by listing available skills after creation

## Modify a Skill

Edit `skills/{skill-name}/SKILL.md` directly.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Skill not found | Check `skills/{skill-name}/SKILL.md` exists |
| Not loading | Verify YAML frontmatter syntax |
