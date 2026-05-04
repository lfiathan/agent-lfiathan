/**
 * @param {import('knex').Knex} knex
 */
export async function seed(knex) {
  // Clean existing data
  await knex('tasks').del();
  await knex('users').del();

  // Insert demo users
  const [user1, user2] = await knex('users')
    .insert([
      {
        email: 'alice@example.com',
        name: 'Alice',
        metadata: JSON.stringify({ telegram_id: null, timezone: 'Asia/Jakarta' }),
      },
      {
        email: 'bob@example.com',
        name: 'Bob',
        metadata: JSON.stringify({ telegram_id: null, timezone: 'Asia/Jakarta' }),
      },
    ])
    .returning('*');

  // Insert demo tasks
  await knex('tasks').insert([
    {
      user_id: user1.id,
      title: 'Review monthly expenses',
      description: 'Go through bank statements for April 2026',
      status: 'pending',
      category: 'finance',
      source: 'api',
    },
    {
      user_id: user1.id,
      title: 'Set up email forwarding',
      description: 'Configure email parsing for transaction notifications',
      status: 'pending',
      category: 'setup',
      source: 'api',
    },
    {
      user_id: user2.id,
      title: 'Test Telegram integration',
      description: 'Verify Hermes responds to Telegram commands',
      status: 'in_progress',
      category: 'general',
      source: 'agent',
      agent_metadata: JSON.stringify({
        skill: 'telegram_test',
        created_by: 'hermes',
      }),
    },
  ]);
}
