import json, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC, OUT = HERE / "t3-code-claude.json", HERE / "t3-code-claude-desktop.json"
CSS_LIMIT = 50_000
CLAY = r"#(?:D97757|C96442|B5573A|E8937A|44342D|5A4030|F2D6C9)|217,\s*119,\s*87|232,\s*147,\s*122"


def luminance(hex_):
    def lin(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = (int(hex_[i : i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast(a, b):
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def darken_until(hex_, on, ratio):
    rgb = [int(hex_[i : i + 2], 16) for i in (1, 3, 5)]
    for step in range(100):
        out = "#%02X%02X%02X" % tuple(round(v * (1 - step / 200)) for v in rgb)
        if contrast(out, on) >= ratio:
            return out
    raise AssertionError(hex_)


def rgb(hex_):
    return ",".join(str(int(hex_[i : i + 2], 16)) for i in (1, 3, 5))


BLUE = "#257DE0"
FILL = darken_until(BLUE, "#FFFFFF", 4.5)
LIGHT_BLUE = "#1F6FD1"

# Sampled from Claude Desktop dark screenshots.
DARK = dict(
    canvas="#191919", chrome="#1B1B1B", toolbar="#1B1B1B", toolbarForeground="#C8C8C8",
    toolbarBorder="#2E2E2E", toolbarControl="#252525", toolbarControlForeground="#C8C8C8",
    toolbarControlHover="#2A2A2A", surface="#252424", surfaceRaised="#2A2A2A",
    surfaceOverlay="#2A2A2A", text="#E4E4E4", textMuted="#929292", border="#2E2E2E",
    input="#303030", focus=BLUE, accent=FILL, accentForeground="#FFFFFF", secondary="#2E2E2E",
    secondaryForeground="#E4E4E4", muted="#222222", mutedForeground="#929292",
    placeholder="#838383", secondaryLabel="#7F7F7F", iconMuted="#929292",
    accentSurface="#2C2C2C", accentSurfaceForeground="#E4E4E4", messageSurface="#25242E",
    messageForeground="#E4E4E4", messageAction=FILL, messageActionForeground="#FFFFFF",
    messageActionHover=darken_until(FILL, "#FFFFFF", 5.5), codeBackground="#202020",
    codeForeground="#E4E4E4", sidebar="#202021", sidebarForeground="#DEDEDE",
    sidebarMutedForeground="#929292", sidebarControlSurface="#2A2A2B", sidebarRowHover="#2C2C2D",
    sidebarRowActive="#414242", sidebarRowSelected="#414242", sidebarBorder="#353535",
    terminalBackground="#191919", terminalForeground="#E4E4E4", terminalCursor=BLUE,
    terminalSelection="#264F78", error="#E5644E", warning="#E49C08",
    searchMatchBackground="#2D4A6E", searchMatchForeground="#FFFFFF",
    searchMatchActiveBackground=FILL, searchMatchActiveForeground="#FFFFFF",
)
LIGHT = dict(
    canvas="#FFFFFF", chrome="#FAFAFA", toolbar="#FFFFFF", toolbarForeground="#3F3F3F",
    toolbarBorder="#E6E6E6", toolbarControl="#FFFFFF", toolbarControlForeground="#3F3F3F",
    toolbarControlHover="#F0F0F0", surface="#FFFFFF", surfaceRaised="#FFFFFF",
    surfaceOverlay="#FFFFFF", text="#1F1F1F", textMuted="#6B6B6B", border="#E3E3E3",
    input="#FFFFFF", focus=LIGHT_BLUE, accent=LIGHT_BLUE, accentForeground="#FFFFFF",
    secondary="#F0F0F0", secondaryForeground="#2B2B2B", muted="#F4F4F4",
    mutedForeground="#6B6B6B", placeholder="#8E8E8E", secondaryLabel="#737373",
    iconMuted="#7A7A7A", accentSurface="#EFEFEF", accentSurfaceForeground="#1F1F1F",
    messageSurface="#EEEEF3", messageForeground="#1F1F1F", messageAction=LIGHT_BLUE,
    messageActionForeground="#FFFFFF", messageActionHover="#195DB0", codeBackground="#F6F6F6",
    codeForeground="#2B2B2B", sidebar="#F7F7F7", sidebarForeground="#2B2B2B",
    sidebarMutedForeground="#6B6B6B", sidebarControlSurface="#EDEDED", sidebarRowHover="#EDEDED",
    sidebarRowActive="#E3E3E4", sidebarRowSelected="#E3E3E4", sidebarBorder="#E3E3E3",
    terminalBackground="#FAFAFA", terminalForeground="#2B2B2B", terminalCursor=LIGHT_BLUE,
    terminalSelection="#CFE1F7", error="#B5452F", warning="#A86A1C",
    searchMatchBackground="#CFE1F7", searchMatchForeground="#1F1F1F",
    searchMatchActiveBackground=LIGHT_BLUE, searchMatchActiveForeground="#FFFFFF",
)

PLUS = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round'%3E%3Cpath d='M12 5v14M5 12h14'/%3E%3C/svg%3E"

NAV = """
div:has(>div.shrink-0>[aria-label="New thread"]){flex-direction:column!important;align-items:stretch!important;gap:2px!important;
&>div.shrink-0{display:contents!important}
&>div:not(.shrink-0),&>div.shrink-0>*{box-sizing:border-box!important;width:100%!important;height:32px!important;min-height:32px!important;max-height:32px!important;margin:0!important;padding:0 10px!important;gap:10px!important;justify-content:flex-start!important;align-items:center!important;border:none!important;border-radius:8px!important;box-shadow:none!important;background:transparent!important;font-size:14px!important;font-weight:400!important;line-height:1!important;color:var(--app-theme-sidebar-foreground)!important;
&:hover,&:focus-within{background:var(--app-theme-sidebar-row-hover)!important}
& svg{width:16px!important;height:16px!important;flex:0 0 16px;color:var(--app-theme-sidebar-foreground)!important}}
&>div:not(.shrink-0){order:-2;& input{font-size:14px!important;font-weight:400!important;padding:0!important;&::placeholder{color:var(--app-theme-sidebar-foreground)!important;opacity:1}}}
&>div.shrink-0>[aria-label="Add project"]::after{content:"Add project"}
&>div.shrink-0>:not([aria-label="New thread"],[aria-label="Add project"]){order:-1;&::after{content:"Projects"}}
&>div.shrink-0>[aria-label="New thread"]{order:-3;position:relative;
& svg{color:transparent!important;background:var(--app-theme-sidebar-foreground);-webkit-mask:url("PLUS") center/16px no-repeat;mask:url("PLUS") center/16px no-repeat}
&::after{content:"New"}
&::before{content:"\\2318N";position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:12px;letter-spacing:.04em;color:var(--app-theme-secondary-label)}}}
""".replace("PLUS", PLUS)

CARD = """
[data-testid=sidebar-row-card]{border-radius:8px!important;
& .text-sm{font-size:14px!important;font-weight:400!important;color:var(--app-theme-sidebar-foreground)!important}
&:is([aria-current],:hover) .text-sm{color:var(--hi2)!important}
&>div:last-child{height:32px!important;min-height:0!important;padding:0 10px!important;display:flex!important;align-items:center!important;gap:0!important;
&>div:first-child{display:contents!important;
&>:not(.size-4,.group\\/sidebar-status-slot){display:none!important}
&>.size-4{order:0;width:16px!important;height:16px!important;flex:0 0 16px;margin-right:10px;border-radius:4px!important;overflow:hidden;& svg{width:100%!important;height:100%!important}}
&>.group\\/sidebar-status-slot{order:4;margin-left:8px;font-size:12px!important;color:var(--app-theme-secondary-label)}}
&>div:nth-child(2){order:1;flex:1 1 auto;min-width:0;margin:0!important;&>:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
&>div:nth-child(3){order:3;flex:none;margin:0 0 0 6px!important;&>:not([aria-hidden]){display:none!important}& svg{width:13px!important;height:13px!important;opacity:.7}}
&>div:nth-child(n+4){display:none!important}}}
"""

COMPOSER = """
[data-slot=composer-host]{background:transparent!important;border:none!important;box-shadow:none!important;border-radius:0!important}
[data-chat-composer-surface]{position:relative;border-radius:0!important}
[data-slot=composer-shell]::before,[data-slot=composer-host]::before,[data-slot=composer-host]::after,[data-chat-composer-main-surface]::after{display:none!important}
[data-chat-composer-main-surface]{padding:0!important}
[data-chat-composer-body]{min-height:43px;padding:10px 44px 10px 13px!important;border-radius:8px;background:var(--app-theme-input);border:1px solid #363636;box-sizing:border-box}
:root:not(.dark) [data-chat-composer-body]{border-color:var(--app-theme-border);box-shadow:var(--csh)}
[data-chat-composer-surface]:focus-within [data-chat-composer-body]{border-color:var(--composer-focus,#4A4A4A)}
:root:not(.dark){--composer-focus:#C8C8C8}
[data-chat-composer-body] .composer-tiptap{min-height:21px!important;margin:0!important;padding:0!important}
[data-chat-composer-body] *{line-height:21px!important}
[data-chat-composer-body] div:has(>div>[data-testid=composer-editor]){font-size:15px!important}
[data-chat-composer-footer]{padding:8px 2px 0!important}
[data-chat-composer-actions=right]>span:last-child{position:absolute;right:6px;top:6px}
[data-chat-composer-actions=right]>button[aria-label$="voice input"]{order:-1;margin-left:-6px}
[data-chat-composer-form] :is(button[type=submit],button.isolate.rounded-full){width:30px!important;height:30px!important}
"""

EXTRA = """
:root:not(.wco){--workspace-topbar-height:44px}
:root:not([data-chat-width=wide],[data-chat-width=full]){--chat-content-max-width:53.125rem}
[data-workspace-area=panel]>[role=separator]>span{background:#272727}
:root:not(.dark) [data-workspace-area=panel]>[role=separator]>span{background:var(--app-theme-border)}
[data-right-panel-tabbar]{background:var(--app-theme-toolbar);border-bottom:1px solid var(--app-theme-toolbar-border)}
[data-right-panel-tabbar] [data-active-tab]{background:transparent!important;font-size:13px;color:var(--mu)!important}
[data-right-panel-tabbar] [data-right-panel-tab-list]:has([data-active-tab=false]) [data-active-tab=true]{color:var(--hi)!important;background:var(--app-theme-accent-surface)!important}
[data-chat-column]:has(~[data-workspace-area=panel][aria-label$=Overview]) button[aria-label=Threads]{color:var(--o4)!important;background:rgba(BLUE_RGB,.14)!important}
section[aria-labelledby^=thread-overview-]{border-top:none!important;padding:8px 8px 14px!important;
&>div:first-child{justify-content:flex-start!important;gap:5px!important}
& h3{font-size:13px!important;font-weight:400!important;color:var(--mu)!important}
&>div:first-child>div{&::before{content:"\\00B7";color:var(--mu)}& span{font-size:13px!important;color:var(--mu)!important}}
& li>button{font-size:14px;& span.flex-1{font-size:14px!important;font-weight:400!important;color:var(--hi)!important}& span.shrink-0:last-child{font-size:13px!important;color:var(--mu)!important}}}
"""

EDITS = [
    (
        "--o:#D97757;--o2:#C96442;--o3:#B5573A;--o4:#E8937A;--hi:#EFEFF0;--hi2:#fff;--mu:#A3A3A3;--mu2:#7E7F80;--mu3:#8E8F8F;--seg:#3A3A3A;--pop:#2A2A2A;--off:#343434;--offi:#7C7C7C;",
        f"--o:{BLUE};--o2:{FILL};--o3:{DARK['messageActionHover']};--o4:#78B0F0;--hi:#E4E4E4;--hi2:#F2F2F2;--mu:#929292;--mu2:#7F7F7F;--mu3:#929292;--seg:#3A3A3A;--pop:#2A2A2A;--off:transparent;--offi:#8A8A8A;",
    ),
    (
        ":root:not(.dark){--pk:#B5573A;--sb:#fff;--sbb:#E5E3DA;",
        f":root:not(.dark){{--o:{LIGHT_BLUE};--o2:#195DB0;--o3:#154F97;--o4:#1A5FB4;--pk:{LIGHT_BLUE};--sb:#fff;--sbb:{LIGHT['border']};",
    ),
    ("--cb:#E8E6DC;", f"--cb:{LIGHT['border']};"),
    (
        "--hi:#141413;--hi2:#141413;--mu:#6B6A64;--mu2:#87867F;--mu3:#73726C;--seg:#fff;--pop:#fff;--off:#E6E4DC;--offi:#9C9A92}",
        "--hi:#1F1F1F;--hi2:#111111;--mu:#6B6B6B;--mu2:#737373;--mu3:#6B6B6B;--seg:#fff;--pop:#fff;--off:#E6E6E6;--offi:#9A9A9A}",
    ),
    (
        'font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif',
        'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Inter Variable","Segoe UI",system-ui,sans-serif',
    ),
    ("letter-spacing:-.01em;color:var(--o)}}", "letter-spacing:-.01em}}"),
    (
        "[data-slot=sidebar-inner]{border-right:1px solid rgba(127,127,127,.12)!important",
        "[data-slot=sidebar-inner]{border-right:1px solid var(--app-theme-sidebar-border)!important",
    ),
    (
        'content:"Recents";order:0;display:block;padding:12px 14px 4px;font-size:13.5px;font-weight:500;color:var(--mu)',
        'content:"Recents";order:0;display:block;padding:18px 9px 8px;font-size:12px;font-weight:400;color:var(--app-theme-sidebar-muted-foreground)',
    ),
    (
        "border-radius:10px!important;font-size:13.5px!important;font-weight:500!important;color:var(--mu)!important",
        "border-radius:8px!important;font-size:12px!important;font-weight:400!important;color:var(--app-theme-sidebar-muted-foreground)!important",
    ),
    (
        "[data-testid=sidebar-row-slim]{height:36px!important;min-height:36px!important;padding:0 10px!important;gap:9px!important;border-radius:10px!important",
        "[data-testid=sidebar-row-slim]{height:32px!important;min-height:32px!important;padding:0 10px!important;gap:10px!important;border-radius:8px!important",
    ),
    (
        "[data-thread-item]{padding-top:1px!important;padding-bottom:1px!important;contain-intrinsic-size:auto 58px!important}",
        "[data-thread-item]{padding-top:1px!important;padding-bottom:0!important;contain-intrinsic-size:auto 33px!important}",
    ),
    (
        '[aria-label="Settle thread"]{color:var(--o)!important;font-weight:500!important;border-radius:6px!important;& svg{color:var(--o)!important;stroke:var(--o)!important}&:hover{color:var(--o4)!important;background:rgba(217,119,87,.14)!important}}',
        '[aria-label="Settle thread"]{color:var(--hi)!important;font-weight:500!important;border-radius:6px!important;& svg{color:var(--hi)!important;stroke:var(--hi)!important}&:hover{color:var(--hi2)!important;background:rgba(127,127,127,.18)!important}}',
    ),
    (
        "[data-chat-header]{border-bottom:1px solid rgba(127,127,127,.09)!important",
        "[data-chat-header]{border-bottom:1px solid var(--app-theme-toolbar-border)!important;background:var(--app-theme-toolbar)!important",
    ),
    (
        ".chat-markdown{font-size:15px!important;line-height:1.55!important;letter-spacing:-.002em;& p{margin:0 0 .75em!important;",
        ".chat-markdown{font-size:15px!important;line-height:21px!important;letter-spacing:-.002em;& p{margin:0 0 14px!important;",
    ),
    (
        "[data-user-message-bubble]{border-radius:14px!important;padding:10px 16px!important;font-size:15px!important;line-height:1.5!important",
        "[data-user-message-bubble]{border-radius:10px!important;padding:12px 16px!important;font-size:15px!important;line-height:21px!important",
    ),
]

BLOCKS = [
    ('div:has(>div.shrink-0>[aria-label="New thread"]){', 'border-radius:5px}}}', NAV),
    ("[data-testid=sidebar-row-card]{", "&>div:nth-child(n+4){display:none!important}}}", CARD),
    ("[data-slot=composer-host]{border-radius:14px!important;", "border-color:#505050!important}}", COMPOSER),
]


def minify(css):
    return re.sub(r"\n\s*", "", css.strip())


def replace_once(css, old, new):
    assert css.count(old) == 1, ("expected once", old[:80], css.count(old))
    return css.replace(old, new)


def replace_block(css, start, end, new):
    i = css.index(start)
    assert css.count(start) == 1, ("block start not unique", start)
    j = css.index(end, i) + len(end)
    return css[:i] + minify(new) + css[j:]


def build_css(css):
    for start, end, new in BLOCKS:
        css = replace_block(css, start, end, new)
    for old, new in EDITS:
        css = replace_once(css, old, new)
    css = re.sub(r"rgba\((?:217,119,87|232,147,122),", f"rgba({rgb(BLUE)},", css)
    return css + minify(EXTRA.replace("BLUE_RGB", rgb(BLUE)))


def main():
    theme = json.loads(SRC.read_text())
    theme.update(
        name="T3 Code Claude", appearance="dark", canvas=DARK["canvas"], accent=DARK["accent"],
        colors=DARK, variants={"light": LIGHT}, css=build_css(theme["css"]),
    )
    assert set(DARK) == set(json.loads(SRC.read_text())["colors"]) == set(LIGHT)
    text = json.dumps(theme, indent=2)
    leftovers = sorted(set(re.findall(CLAY, text, re.I)))
    assert not leftovers, ("clay left", leftovers)
    assert "T3 Clawd" not in text
    assert len(theme["css"]) < CSS_LIMIT, len(theme["css"])
    for name, p in (("dark", DARK), ("light", LIGHT)):
        checks = {
            "text/canvas": contrast(p["text"], p["canvas"]),
            "sidebarMuted/sidebar": contrast(p["sidebarMutedForeground"], p["sidebar"]),
            "accentForeground/accent": contrast(p["accentForeground"], p["accent"]),
            "messageActionForeground/messageAction": contrast(p["messageActionForeground"], p["messageAction"]),
        }
        print(name, {k: round(v, 2) for k, v in checks.items()})
        assert checks["text/canvas"] >= 7, name
        assert checks["sidebarMuted/sidebar"] >= 4.5, name
        assert checks["accentForeground/accent"] >= 4.5, name
        assert checks["messageActionForeground/messageAction"] >= 4.5, name
    OUT.write_text(text + "\n")
    print("css chars", len(theme["css"]), "mark", BLUE, "fill", FILL, "->", OUT)


if __name__ == "__main__" and not sys.argv[1:]:
    main()
