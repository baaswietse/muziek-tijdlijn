import { useState } from 'preact/hooks';

// Schermen voor wie via een uitnodigingslink of QR-code binnenkomt. Bewust
// sober: de code staat al in de link, dus geen tabs en geen codeveld.

/** Meedoen loopt; er valt niets in te vullen. */
export function InviteBusy({ code }) {
  return (
    <main class="page center" data-testid="invite-busy">
      <p class="muted">Meedoen met spel {code}…</p>
    </main>
  );
}

/** Enkel een naam vragen. `session` is het spel waarin je nu nog zit, of null. */
export function InviteJoin({ invite, session, onSubmit, onCancel }) {
  const [name, setName] = useState(invite.name || '');

  function submit(ev) {
    ev.preventDefault();
    if (!invite.busy) onSubmit(name);
  }

  return (
    <main class="page" data-testid="invite-screen">
      <section class="hero">
        <h1>
          Je doet mee met spel <span class="invite-code">{invite.code}</span>
        </h1>
        <p class="muted">Kies een naam die de anderen herkennen.</p>
      </section>

      <form class="card form" onSubmit={submit}>
        {invite.error && (
          <p class="notice error" role="alert" data-testid="invite-error">
            {invite.error}
          </p>
        )}
        <label class="field">
          <span>Je naam</span>
          <input
            class="input"
            data-testid="invite-name"
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder="bv. Sam"
            maxLength={16}
            autoComplete="nickname"
            autoFocus
          />
        </label>
        <button class="btn primary big" type="submit" disabled={invite.busy} data-testid="invite-join">
          {invite.busy ? 'Even geduld…' : 'Doe mee'}
        </button>
      </form>

      <button class="btn link invite-other" onClick={onCancel} data-testid="invite-cancel">
        {session ? `Terug naar spel ${session.code}` : 'Ander spel of zelf een spel maken'}
      </button>
    </main>
  );
}

/** De host van een ander spel kiest zelf of hij overstapt. */
export function InviteConfirm({ invite, onStepOver, onStay }) {
  const { code, from } = invite;
  return (
    <main class="page center">
      <section class="card invite-confirm" role="alertdialog" aria-labelledby="invite-confirm-title" data-testid="invite-confirm">
        <h1 id="invite-confirm-title" class="invite-confirm-title">
          Overstappen naar spel {code}?
        </h1>
        <p>
          Je bent host van spel {from}. Stap je over naar {code}, dan valt dat spel stil voor de anderen.
        </p>
        <button class="btn primary big" onClick={onStepOver} data-testid="invite-step-over">
          Stap over naar {code}
        </button>
        <button class="btn big" onClick={onStay} data-testid="invite-stay">
          Blijf in {from}
        </button>
      </section>
    </main>
  );
}
