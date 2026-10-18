using Patriark.Domain.Decisions;
using Patriark.Infrastructure.Persistence;
using Xunit;

namespace Patriark.Tests;

public sealed class ZzBenchLiving
{
    [Fact]
    public async Task LivingCharactersSkipTheDeadInIdOrder()
    {
        var session = await ZzBenchSession.Open(new AlternatingSaveStore(ZzBenchSession.Folder()));
        var state = session.DiagnosticSnapshot();
        var first = state.Characters.Keys.OrderBy(x => x, StringComparer.Ordinal).First();
        state.Characters[first].Lifecycle = "dead";
        var living = GameRules.LivingCharacters(state).Select(c => c.Id).ToArray();
        Assert.DoesNotContain(first, living);
        Assert.Equal(state.Characters.Values.Where(c => c.Lifecycle != "dead").Select(c => c.Id).OrderBy(x => x, StringComparer.Ordinal), living);
    }
}
