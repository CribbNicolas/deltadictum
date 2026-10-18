using Patriark.Domain.Decisions;
using Patriark.Infrastructure.Persistence;
using Xunit;

namespace Patriark.Tests;

public sealed class ZzBenchShortRest
{
    private static async Task<Patriark.Application.Session.GameSession> OnExpedition()
    {
        var session = await ZzBenchSession.Open(new AlternatingSaveStore(ZzBenchSession.Folder()));
        await ZzBenchSession.EquipAndStart(session);
        // The guild's node is the refuge, whose services replace the node actions: explore a section to stand
        // on a node of the expedition.
        var section = session.View().Map!.Sections.First(x => x.Preview.Command is ExploreSection);
        Assert.True((await session.ExecuteAsync(section.Preview.Command!)).Confirmed);
        return session;
    }

    [Fact]
    public async Task OffersAShortRest()
    {
        var session = await OnExpedition();
        Assert.Contains(session.View().Actions, a => a.Command is Rest { Minutes: 10 });
    }

    [Fact]
    public async Task ShortRestIdIsStable()
    {
        var session = await OnExpedition();
        string IdOf() => session.View().Actions.Single(a => a.Command is Rest { Minutes: 10 }).Command.Id;
        var first = IdOf();
        Assert.Equal(first, IdOf());
        Assert.StartsWith($"bench:{session.View().Revision}:", first);
    }

    [Fact]
    public async Task OpenMapStaysLast()
    {
        var session = await OnExpedition();
        Assert.IsType<OpenMap>(session.View().Actions[^1].Command);
    }
}
