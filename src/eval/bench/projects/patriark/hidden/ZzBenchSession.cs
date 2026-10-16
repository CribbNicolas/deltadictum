using Patriark.Application.Session;
using Patriark.Domain.Decisions;
using Patriark.Infrastructure.Content;
using Patriark.Infrastructure.Persistence;
using Xunit;

namespace Patriark.Tests;

/// <summary>Helpers the bench's hidden tests share: a session over the current pack in an isolated folder.</summary>
internal static class ZzBenchSession
{
    public static string Root
    {
        get { var path = new DirectoryInfo(AppContext.BaseDirectory); while (path is not null && !File.Exists(Path.Combine(path.FullName, "project.godot"))) path = path.Parent; return path?.FullName ?? throw new Exception("Project root missing"); }
    }
    public static string Folder() => Path.Combine(Root, "tmp", "tests", "bench-" + Guid.NewGuid().ToString("N"));
    public static Task<GameSession> Open(AlternatingSaveStore store) => GameSession.OpenAsync(store, JsonContentCatalog.FromDirectory(Root), new SnapshotCodec(), seed: "bench-seed", sessionId: "bench");
    public static async Task<CommandResult> Do(GameSession session, Func<string, long, GameCommand> create)
    {
        var revision = session.View().Revision;
        var result = await session.ExecuteAsync(create("bench-" + revision, revision));
        Assert.True(result.Confirmed, result.Message.Key);
        return result;
    }
    public static async Task EquipAndStart(GameSession session, string actor = "mara")
    {
        await Do(session, (id, r) => new MoveWithinNode(id, r, "guild"));
        await Do(session, (id, r) => new TransferResource(id, r, actor, "water", 6, true));
        await Do(session, (id, r) => new TransferResource(id, r, actor, "rations", 3, true));
        await Do(session, (id, r) => new StartExpedition(id, r, actor));
    }
}
