using Patriark.Domain.Decisions;
using Patriark.Infrastructure.Persistence;
using Xunit;

namespace Patriark.Tests;

public sealed class ZzBenchRest
{
    [Fact]
    public async Task RestsOnAnExpedition()
    {
        using var store = new AlternatingSaveStore(ZzBenchSession.Folder());
        var session = await ZzBenchSession.Open(store);
        await ZzBenchSession.EquipAndStart(session);
        var before = session.View().TimeMinutes;
        await ZzBenchSession.Do(session, (id, r) => new Rest(id, r, 60));
        Assert.True(session.View().TimeMinutes > before);
    }
}
