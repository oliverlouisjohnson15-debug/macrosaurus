"""Screens: You (behind the gear), Play (from the buddy), Onboarding."""
from kit import *
from screens_a import root, sub, today_body

SCREENS = []
def screen(id, group, title, note=''):
    def deco(fn):
        SCREENS.append(dict(id=id, group=group, title=title, note=note, fn=fn)); return fn
    return deco

def toggle_row(t, s, on, icon=None):
    return (f'<div class="row">{"<span class=lead>" + ic(icon) + "</span>" if icon else ""}<div class="grow"><div class="t">{t}</div>{"<div class=s>" + s + "</div>" if s else ""}</div>'
            f'<button class="tog-hit" role="switch" aria-checked="{str(on).lower()}" aria-label="{t}"><span class="tog{" on" if on else ""}"></span></button></div>')

# ============================================================== YOU
@screen('you', 'You', 'You (settings)', 'Behind the gear. One list, values on the right, no inline controls and no search (14 rows).')
def _():
    body = (row('oliver@…', 'Premium · renews 3 Nov', 'user', attrs='data-primary')
            + section('Body', row('Body details', 'Male · 32 · 178 cm · moderately active', 'user') + row('Cycle tracking', 'Off', 'calendar'))
            + section('Food', row('Default meals', 'Breakfast, Lunch, Dinner, Snacks', 'food') + toggle_row('Share my recipes', 'Helps the community library', True, 'book'))
            + section('Reminders &amp; apps', row('Reminders', 'Push on · nudge after 2pm', 'bell') + row('Apps &amp; data', 'Google Health connected', 'plug'))
            + section('Appearance', row('Theme', None, 'palette', '<span class="sm">Paper</span>') + row('Units', None, 'ruler', '<span class="sm">kg · cm</span>') + row('Arrange Today', None, 'sliders'))
            + section('Help', row('Send feedback', None, 'chat') + row('Replay the intro', None, 'play') + row('Privacy, terms &amp; credits', None, 'lock')))
    return sub('You', body, 'Today')

@screen('you-account', 'You', 'Account & Premium', 'Account and subscription together (the Settings | Account switch goes).')
def _():
    body = (row('oliver@…', 'Signed in with Google', 'user', chev=False, attrs='data-primary')
            + section('Premium', row('Premium', 'Renews 3 Nov · £4.99 a month', 'star', '<span class="sm">Manage</span>') + row('AI logs', 'Unlimited', 'sparkle', chev=False)
                      + row('Invite friends', 'Get free AI logs for each friend', 'share'))
            + section('Your data', row('Export my data', 'A JSON file of everything', 'share') + row('Sign out', None, 'back', chev=False))
            + section('Danger zone', row('Reset data', 'Start again with nothing logged', 'trash') + row('Delete account', 'Removes everything, for good', 'trash')))
    return sub('Account', body, 'You')

@screen('you-body', 'You', 'Body details', 'A form. What changes your numbers says so once, at the foot.')
def _():
    body = ('<div class="form" data-primary><div><label class="lbl">Sex</label>' + seg(['Male', 'Female'], 'Male') + '</div>'
            '<div class="pair">' + field(None, '32', label='Age', unit='years') + field(None, '178', label='Height', unit='cm') + '</div>'
            '<div><label class="lbl">Day to day</label>' + seg(['Low', 'Moderate', 'High'], 'Moderate') + '</div>' + row('Steps', 'From Google Health · 8,400 a day', 'plug', chev=False) + '</div>'
            '<p class="sm muted" style="margin-top:12px">Changing these resets your calorie estimate.</p>')
    return sub('Body details', body, 'You', foot=btn('Save', 'a', w=True))

@screen('you-meals', 'You', 'Default meals', 'Reorder, rename, add. The diary follows this list.')
def _():
    rows = ''.join(f'<div class="row"><span class="lead" aria-hidden="true">{ic("more")}</span><div class="grow t">{m}</div><button class="btn t" style="min-height:44px">Rename</button></div>' for m in ['Breakfast', 'Lunch', 'Dinner', 'Snacks'])
    return sub('Default meals', f'<div data-primary>{rows}</div><div class="sp16"></div>' + btn('Add a meal', 'b', 'plus', w=True), 'You')

@screen('you-reminders', 'You', 'Reminders', 'Each nudge is one switch. Times are one row each.')
def _():
    body = ('<div data-primary>' + toggle_row('Push reminders', 'Chompers nudges you to log', True, 'bell') + '</div>'
            + toggle_row('In-app nudge banner', 'When you open the app', True, 'chat') + row('Nudge after', None, 'clock', '<span class="sm">2pm</span>'))
    return sub('Reminders', body, 'You')

@screen('you-apps', 'You', 'Apps & data', 'What’s connected, then what’s coming (you can ask for one).')
def _():
    body = (section('Connected', row('Google Health', 'Steps, sleep and weight · synced 9:12', 'plug', '<span class="sm" style="color:var(--good-ink);font-weight:600">On</span>'), attrs='data-primary')
            + section('Coming soon', toggle_row('Apple Health', 'Tell me when it’s ready', True) + toggle_row('Garmin', None, False) + toggle_row('Withings scales', None, False) + toggle_row('Oura', None, False)))
    return sub('Apps &amp; data', body, 'You')

@screen('you-appearance', 'You', 'Theme & units (sheet)', 'Theme and units moved off the list into one small sheet.')
def _():
    body = ('<div class="form" data-primary><div><label class="lbl">Theme</label>' + seg(['Paper', 'Dark'], 'Paper') + '</div>'
            '<div><label class="lbl">Weight</label>' + seg(['kg', 'st / lb'], 'kg') + '</div><div><label class="lbl">Height</label>' + seg(['cm', 'ft / in'], 'cm') + '</div>'
            '</div>')
    return sub('You', '') + sheet('Theme &amp; units', body)

@screen('premium', 'You', 'Premium (sheet)', 'The paywall: the buddy says why once, four rows say what, one button.')
def _():
    body = (mini('I can read labels, photos and menus for you, and coach you every week.', 'talk')
            + '<div data-primary>' + section('Premium adds', row('Photo, label and menu logging', None, 'camera', chev=False) + row('Weekly coaching changes', None, 'chat', chev=False)
                                         + row('Energy and body-fat detail', None, 'bolt', chev=False) + row('Talk to Chompers', None, 'sparkle', chev=False)) + '</div>'
            + '<div class="sp16"></div>' + seg(['£4.99 a month', '£39.99 a year'], '£39.99 a year'))
    return root('today', today_body()) + sheet('Premium', body, btn('Start 7-day free trial', 'a', w=True) + '<p class="xs muted center" style="margin-top:8px">Then £39.99 a year. Cancel any time.</p>', tall=True)

# ============================================================== PLAY
def play_hero():
    return hero('<div class="terra"><div class="sun"></div><div class="ground"></div><div class="who idle" style="background-image:url(../assets/chompers-idle.png)"></div></div>'
                '<div><div class="split"><span class="num" style="font-size:20px">CHOMPERS</span><span class="sm muted">Saurling · day 41</span></div>'
                '<div class="split sm" style="margin:10px 0 6px"><span class="b">Growth</span><span class="muted">1 day to Veloci</span></div>' + hp(92, 'cal', 20, '', 'Growth 92%')
                + '<div class="split sm" style="margin:10px 0 6px"><span class="b">Fed today</span><span class="muted">peckish</span></div>' + hp(51, 'gold', 10, '', 'Fed 51%') + '</div>', 'data-primary', 'card-tile')

@screen('play', 'Play', 'Play · buddy', 'Opened by tapping Chompers. Terrarium is the hero; Battle and Shop are the two other places.')
def _():
    rows = row('Talk to Chompers', None, 'chat') + row('Trophies', '12 of 40', 'trophy') + row('Dress up', 'Straw hat on', 'shirt') + row('Streak', '13 days · freeze ready', 'flame', chev=False)
    return sub('Play', seg(['Buddy', 'Battle', 'Shop'], 'Buddy') + '<div class="sp16"></div>' + play_hero() + section('Chompers', rows), 'Today', '100 amber', None)

@screen('play-battle', 'Play', 'Play · battle', 'This week’s boss. HP bars are literal here; one Fight button.')
def _():
    h = hero('<div class="terra"><div class="ground"></div><div class="who idle" style="left:30%;background-image:url(../assets/chompers-idle.png)"></div><div class="who boss" style="left:72%;background-image:url(../assets/boss-idle.png)"></div></div>'
             '<div><div class="split sm"><span class="b">Dreadplate</span><span class="muted">boss · 4 days left</span></div>' + hp(100, 'pro', 20, '', 'Dreadplate HP 200 of 200')
             + '<div class="split sm" style="margin-top:10px"><span class="b">Chompers</span><span class="muted"><span class="fig">116</span> HP</span></div>' + hp(100, 'cal', 20, '', 'Chompers HP')
             + '<p class="sm" style="margin-top:10px">Weak to protein: every protein target you hit this week lands 1.35×.</p></div>', 'data-primary', 'card-tile')
    body = seg(['Buddy', 'Battle', 'Shop'], 'Battle') + '<div class="sp16"></div>' + h + section('Today', row('Daily hunt', 'Ready · hit a macro target to charge', 'sword'))
    return sub('Play', body, 'Today', '100 amber', None, foot=btn('Fight Dreadplate', 'a', 'sword', w=True))

@screen('play-shop', 'Play', 'Play · shop', 'Amber to spend. Each item is a row with its price.')
def _():
    items = [('Ember aura', 'A warm glow that follows your buddy', 180), ('Moonlit marsh', 'Still water, reeds and fireflies', 260), ('Frozen lake', 'Cracked ice under a cold sky', 260), ('Hunter’s pennant', 'A torn flag, one notch per streak day', 200)]
    rows = ''.join(f'<div class="row" {"data-primary" if i == 0 else ""}><span class="thumb" style="width:44px;height:44px">{ic("star")}</span><div class="grow"><div class="t">{t}</div><div class="s">{s}</div></div><button class="btn" style="min-height:44px;padding:0 10px"><span class="fig">{p}</span></button></div>' for i, (t, s, p) in enumerate(items))
    return sub('Play', seg(['Buddy', 'Battle', 'Shop'], 'Shop') + section('This week’s stall', rows, meta='4 days left'), 'Today', '100 amber', None)

@screen('play-trophies', 'Play', 'Trophies', 'Earned first, then the next few to aim for.')
def _():
    got = ''.join(row(t, s, 'trophy', chev=False, attrs='data-primary' if i == 0 else '') for i, (t, s) in enumerate([('First hatch', 'Hatched Chompers'), ('Protein week', '7 days on protein'), ('Iron streak', '10-day logging streak')]))
    nxt = ''.join(row(t, s, 'lock', chev=False) for t, s in [('Veloci', 'Grow to the next stage · 1 day'), ('Boss slayer', 'Beat 3 weekly bosses · 1 of 3')])
    return sub('Trophies', section('Earned', got, meta='12 of 40') + section('Next up', nxt), 'Play')

@screen('play-dressup', 'Play', 'Dress up', 'What’s owned, by slot. Tap to wear.')
def _():
    h = hero('<div class="terra" style="height:132px"><div class="ground"></div><div class="who idle" style="background-image:url(../assets/chompers-idle.png)"></div></div>', 'data-primary', 'card-tile')
    rows = row('Hat', 'Straw hat', 'shirt', '<span class="sm">Change</span>') + row('Aura', 'None', 'sparkle', '<span class="sm">Change</span>') + row('Scene', 'Dawn flats', 'grid', '<span class="sm">Change</span>')
    return sub('Dress up', h + section('Wearing', rows), 'Play')

@screen('milestone', 'Play', 'Milestone', 'A growth stage or goal moment: the buddy’s scene and one line, then one button. Replaces the confetti modal.')
def _():
    body = (dialogue('I grew! That’s your consistency doing that, not mine. Chompers is a Veloci now.', None, mood='Veloci', pose='cheer', emote='!', attrs='data-primary')
            + '<div class="sp16"></div>' + row('Stage', 'Saurling → Veloci · day 42', 'egg', chev=False) + row('Next', 'Rex · 30 more days of logging', 'star', chev=False))
    return sub('Milestone', body, 'Today', foot=btn('Nice one', 'a', w=True))

@screen('hatch', 'Play', 'Hatching', 'The first-week moment: the egg hatches in a scene, then asks for a name.')
def _():
    body = ('<div class="terra" style="height:220px;margin:-12px -16px 0" data-primary><div class="sun"></div><div class="ground"></div><div class="who" style="width:120px;height:120px;margin-left:-60px;background:url(../assets/egg-hatch.png) -360px 0 / 480px 120px;image-rendering:pixelated"></div></div>'
            + '<div class="win dbox" style="margin-top:22px">' + TAIL.replace('class="tail"', 'class="tail" style="left:calc(50% - 12px)"') + '<div class="name">???</div><p data-buddy>Rawr! …hi. I’m yours now. What will you call me?</p></div><div class="sp16"></div>'
            + field(None, 'Chompers', label='Name', focus=True, inbtn=[('swap', 'Suggest a name')]))
    return sub('Your egg hatched', body, 'Today', foot=btn('That’s my name', 'a', w=True))

# ============================================================== ONBOARDING
def ob(body, step=None, back=True, foot=''):
    top = '<div class="top">' + (f'<button class="btn t" aria-label="Back" style="min-width:44px">{ic("back")}</button>' if back else '<img src="../assets/egg-logo.png" alt="" style="width:32px;height:32px;image-rendering:pixelated">')
    if step: top += f'<div class="grow"><div class="steps">' + ''.join(f'<i class="{"on" if k < step else ""}"></i>' for k in range(4)) + f'</div></div><span class="sm muted">{step} of 4</span>'
    top += '</div>'
    return f'<main class="ob">{top}<div class="mid">{body}</div>{foot}</main>'

@screen('ob-signin', 'Onboarding', '1 · Sign in', 'The only place the wordmark appears.')
def _():
    body = ('<div class="center" style="padding-top:60px" data-primary><img src="../assets/egg-logo.png" alt="" style="width:120px;height:120px;image-rendering:pixelated">'
            '<h1 class="num" style="font-size:28px;margin-top:12px">MACROSAURUS</h1><p class="muted">Macros that retune every week, and a dino to do it with.</p></div>')
    foot = btn('Continue with Google', 'a', w=True) + '<div class="sp8"></div>' + btn('Continue with email', 'b', w=True) + '<p class="xs muted center" style="margin-top:12px">By continuing you agree to the terms and privacy policy.</p>'
    return ob(body, back=False, foot=foot)

@screen('ob-hello', 'Onboarding', '2 · Hello', 'The egg introduces itself in the dialogue box; the familiarity question is a ▶ menu.')
def _():
    body = ('<div class="sp24"></div>' + dialogue('Hi! I’m your buddy. Well, I will be once I hatch. I’ll set your calories and protein and retune them every week. How well do you know macros?',
                                                  [('New to this', 'teach me as I go'), ('I’ve tracked before', 'just the nudges')], name='Your egg', emote='!', pose='egg', attrs='data-primary'))
    return ob(body, back=False)

@screen('ob-egg', 'Onboarding', '3 · Choose your egg', 'Twelve eggs, one tap, one button.')
def _():
    hues = [0, 40, 80, 120, 160, 200, 240, 280, 320, 20, 100, 180]
    grid = '<div class="egg-grid" data-primary>' + ''.join(f'<button class="{"on" if i == 0 else ""}" aria-label="Egg {i + 1} of 12" style="--h:{h}deg"><i style="--h:{h}deg"></i></button>' for i, h in enumerate(hues)) + '</div>'
    body = '<h1>Choose your egg</h1><p class="muted" style="margin-bottom:16px">Nobody knows what’s inside yet.</p>' + grid
    return ob(body, foot=btn('This one', 'a', w=True))

@screen('ob-about', 'Onboarding', '4 · About you', 'Step 1 of 4. Units sit next to the field they change.')
def _():
    body = ('<h1>About you</h1><p class="muted" style="margin-bottom:16px">So I can work out your numbers.</p><div class="form" data-primary>'
            '<div><label class="lbl">Sex</label>' + seg(['Male', 'Female'], 'Male') + '</div><div class="pair">' + field(None, '32', label='Age', unit='years') + field(None, '178', label='Height', unit='cm') + '</div>'
            '<div class="pair">' + field(None, '85.2', label='Weight', unit='kg', focus=True) + '<div><label class="lbl">Units</label>' + seg(['kg', 'st / lb'], 'kg') + '</div></div></div>')
    return ob(body, 1, foot=btn('Continue', 'a', w=True))

@screen('ob-active', 'Onboarding', '5 · How active', 'Step 2. Choices are a ▶ menu, not a grid of cards.')
def _():
    opts = [('Mostly sitting', 'desk job, under 5k steps'), ('On my feet a bit', '5–8k steps'), ('Moderately active', '8–12k steps, some training'), ('Very active', 'physical job or daily training')]
    menu = '<div class="menu" data-primary style="border-top:2px solid var(--ink)">' + ''.join(f'<button class="{"sel" if i == 2 else ""}" style="min-height:60px;flex-wrap:wrap"><span class="grow">{t}<br><span class="sm muted" style="font-weight:400">{s}</span></span></button>' for i, (t, s) in enumerate(opts)) + '</div>'
    return ob('<h1>How active are you?</h1><p class="muted" style="margin-bottom:16px">Day to day, not just the gym.</p>' + menu, 2, foot=btn('Continue', 'a', w=True))

@screen('ob-goal', 'Onboarding', '6 · Your goal', 'Step 3. Goal, goal weight and pace on one screen.')
def _():
    body = ('<h1>What are we aiming for?</h1><p class="muted" style="margin-bottom:16px">We can change course later.</p><div class="form" data-primary><div><label class="lbl">Goal</label>' + seg(['Lose fat', 'Maintain', 'Build'], 'Lose fat') + '</div>'
            + field(None, '78.0', label='Goal weight', unit='kg') + '<div><label class="lbl">Pace</label>' + seg(['Gentle', 'Steady', 'Fast'], 'Steady') + '</div></div>'
            '<p class="sm muted" style="margin-top:10px">Steady is 0.5 kg a week: 78.0 kg around late November.</p>')
    return ob(body, 3, foot=btn('Continue', 'a', w=True))

@screen('ob-plan', 'Onboarding', '7 · Your starting plan', 'Step 4. The numbers in the same hero Today will use.')
def _():
    h = hero('<div><span class="bignum">2236</span> <span class="unit">kcal a day</span></div><div class="sp16"></div><div class="macros">'
             + ''.join(f'<div class="macro"><div class="k {k}">{n}</div><div class="v"><span class="fig">{v}</span><span class="unit">g</span></div></div>' for k, n, v in [('pro', 'Protein', 131), ('carb', 'Carbs', 257), ('fat', 'Fat', 70)])
             + '</div>', 'data-primary')
    body = '<h1>Your starting plan</h1><p class="muted" style="margin-bottom:16px">I’ll retune it from your check-ins.</p>' + h + '<div class="sp8"></div>' + row('Show me the maths', None, 'help')
    return ob(body, 4, foot=btn('Start', 'a', w=True))

@screen('ob-ready', 'Onboarding', '8 · All set', 'Hands over to Today, where the egg keeps talking.')
def _():
    body = '<div class="sp24"></div>' + dialogue('That’s your plan sorted. Log your first meal and I’ll start to hatch. One nudge at a time, promise.', None, name='Your egg', emote='♪', pose='egg', attrs='data-primary')
    return ob(body, back=False, foot=btn('Let’s go', 'a', w=True))
