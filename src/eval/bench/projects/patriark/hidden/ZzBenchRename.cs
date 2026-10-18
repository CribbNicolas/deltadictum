using Patriark.Domain.Decisions;
using Patriark.Infrastructure.Persistence;
using Xunit;

namespace Patriark.Tests;

public sealed class ZzBenchRename
{
    [Fact]
    public async Task RenamesAtTheGuildAndKeepsItOnReload()
    {
        var folder = ZzBenchSession.Folder();
        using (var store = new AlternatingSaveStore(folder))
        {
            var session = await ZzBenchSession.Open(store);
            await ZzBenchSession.Do(session, (id, r) => new MoveWithinNode(id, r, "guild"));
            await ZzBenchSession.Do(session, (id, r) => new RenameCharacter(id, r, "mara", "Mira"));
            Assert.Equal("Mira", session.DiagnosticSnapshot().Characters["mara"].Name);
        }
        using var again = new AlternatingSaveStore(folder);
        var reloaded = await ZzBenchSession.Open(again);
        Assert.Equal("Mira", reloaded.DiagnosticSnapshot().Characters["mara"].Name);
    }
}
